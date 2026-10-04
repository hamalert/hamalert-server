const axios = require('axios');
const fs = require('fs');
const config = require('./config_loader');

/*
	QuadNet "Smart Group" directory

	QuadNet Smart Groups are STARnet-style routing groups: a user puts a group callsign in the
	radio's UR field (e.g. "DSTAR1", or "QNET20 C") and keys up; the group server (KN4RSC)
	subscribes them and relays their audio to every other subscriber. dstar.js's classify() would
	otherwise drop these UR values entirely - they are neither CQCQCQ, a link command, area
	routing, nor callsign-shaped - so this module resolves them to the group they name.

	Group *definitions* (not activity - that comes from the QuadNet heard log tailed by
	QuadnetFeed in dstar.js) live at https://www.openquad.net/starnet.php, an HTML page with two
	tables: "Group Users" (current subscribers, not used here) and "QuadNet Smart Groups" (one
	row per group: Subscribe/Unsubscribe UR values, currently-bridged reflector, status, timeout,
	rx-only flag, routing module, description, last update). Only the second table is parsed (see
	parseStarnetPage below), and only hourly - group definitions change rarely, unlike activity.

	Two Maps are built, keyed by the UR value padded to 8 characters with trailing spaces (the
	same shape dstar.js's cleanField() leaves record.ur in): subscribe -> {call, name, module},
	and unsubscribe -> true (used only to recognize an unsubscribe command as control traffic,
	like an ircDDB unlink).

	Like dstar_nodes.js, the merged map is persisted to options.dumpFile so a restart has data
	immediately; options.static seeds lookups before the first fetch completes, and again if the
	fetch fails while the dump was empty (a fresh install with no dump and no network yet).
*/

const userAgent = 'HamAlert/1.0 (+https://hamalert.org)';

function htmlUnescape(text) {
	return text
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;/gi, "'");
}

// Strip tags and unescape entities, but only trim TRAILING whitespace: the Subscribe/Unsubscribe
// columns pad with &nbsp; to 8 characters, but a value like "QNET20 C" carries a real, meaningful
// internal space that must survive.
function cleanCellRightTrim(html) {
	return htmlUnescape(html.replace(/<[^>]*>/g, '')).replace(/\s+$/, '');
}

// Strip tags, unescape entities, and collapse/trim ALL whitespace (used for columns where
// internal spacing carries no meaning: the Module and Description cells).
function cleanCell(html) {
	return htmlUnescape(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function extractRawCells(rowHtml) {
	let cells = [];
	let cellRegex = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
	let matches;
	while ((matches = cellRegex.exec(rowHtml)) !== null) {
		cells.push(matches[1]);
	}
	return cells;
}

// "KN4RSC&nbsp;A" (cell text once cleaned) -> "KN4RSC-A", like dstar_nodes.js's node fields but
// space- rather than underscore-separated.
const moduleCellRegex = /^([A-Z0-9]+)\s+([A-Z])$/i;
function formatModule(rawCell) {
	let matches = moduleCellRegex.exec(cleanCell(rawCell));
	if (!matches) {
		return undefined;
	}
	return `${matches[1].toUpperCase()}-${matches[2].toUpperCase()}`;
}

// Pad a Subscribe/Unsubscribe value out to the 8-character width record.ur always arrives in
// (see dstar.js's cleanField()), so it can be used directly as a Map key against record.ur.
function padUr(value) {
	return (value || '').padEnd(8, ' ').substring(0, 8);
}

/*
	Parse a saved/fetched starnet.php page into an array of {subscribe, unsubscribe, module, name}.

	Finds the table whose header row's first cell is "Subscribe" (the "QuadNet Smart Groups"
	table) and reads every row after it until the table closes; the "Group Users" table (and
	anything else on the page) is ignored because its header never matches. Tolerant of extra
	whitespace/attributes on the tags; returns [] if the expected table isn't found on the page.
*/
function parseStarnetPage(html) {
	let groups = [];
	let headerRowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
	let match;
	let tableBody = null;

	while ((match = headerRowRegex.exec(html)) !== null) {
		let cells = extractRawCells(match[1]);
		if (cleanCell(cells[0] || '') === 'Subscribe') {
			let tableEnd = html.indexOf('</table>', headerRowRegex.lastIndex);
			tableBody = html.slice(headerRowRegex.lastIndex, tableEnd === -1 ? html.length : tableEnd);
			break;
		}
	}

	if (tableBody === null) {
		return groups;	// no "QuadNet Smart Groups" table on this page
	}

	let dataRowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
	let rowMatch;
	while ((rowMatch = dataRowRegex.exec(tableBody)) !== null) {
		let cells = extractRawCells(rowMatch[1]);
		if (cells.length < 8) {
			continue;	// not a data row of this table's shape
		}
		let subscribe = cleanCellRightTrim(cells[0]);
		if (!subscribe) {
			continue;
		}
		groups.push({
			subscribe,
			unsubscribe: cleanCellRightTrim(cells[1]),
			module: formatModule(cells[6]),
			name: cleanCell(cells[7])
		});
	}
	return groups;
}

class DstarGroupDirectory {
	constructor() {
		this.options = config.dstar.smartGroups || {};
		this.subscribeMap = new Map();
		this.unsubscribeMap = new Map();
		this.loggedFetchFailure = false;

		let loadedFromDump = false;
		if (this.options.dumpFile && fs.existsSync(this.options.dumpFile)) {
			try {
				let groups = JSON.parse(fs.readFileSync(this.options.dumpFile, {encoding: 'utf8'}));
				this.setGroups(groups);
				loadedFromDump = this.subscribeMap.size > 0;
				console.log(`D-STAR group directory: loaded ${groups.length} groups from ${this.options.dumpFile}`);
			} catch (e) {
				console.error(`D-STAR group directory: failed to read dump file ${this.options.dumpFile}: ${e}`);
			}
		}

		// Seed from the static list so lookups work before the first fetch completes; only when
		// the dump didn't already give us something better.
		if (!loadedFromDump && Array.isArray(this.options.static) && this.options.static.length > 0) {
			this.setGroups(this.options.static);
			console.log(`D-STAR group directory: seeded ${this.options.static.length} static group(s), pending first fetch`);
		}

		this.refresh();
		// unref: don't keep a short-lived tool (tools/dstarTest.js replays) alive just for this
		setInterval(() => this.refresh(), this.options.refreshInterval || 3600000).unref();
	}

	setGroups(groups) {
		let subscribeMap = new Map();
		let unsubscribeMap = new Map();
		for (let group of (groups || [])) {
			if (!group || !group.subscribe) {
				continue;
			}
			subscribeMap.set(padUr(group.subscribe), {
				call: group.subscribe.trim(),
				name: group.name,
				module: group.module
			});
			if (group.unsubscribe) {
				unsubscribeMap.set(padUr(group.unsubscribe), true);
			}
		}
		this.subscribeMap = subscribeMap;
		this.unsubscribeMap = unsubscribeMap;
	}

	// Look up a raw UR value (8 characters, as record.ur arrives - see dstar.js's cleanField()).
	// Returns {call, name, module} or null.
	lookup(ur) {
		if (!ur) {
			return null;
		}
		return this.subscribeMap.get(ur) || null;
	}

	// Whether a raw UR value is a group's unsubscribe/leave command (control traffic, never alert).
	isUnsubscribe(ur) {
		return !!ur && this.unsubscribeMap.has(ur);
	}

	// Returns a promise that resolves once the refresh attempt has finished (whether it
	// succeeded or failed; failures are handled internally, see below).
	refresh() {
		return axios({
			url: this.options.url,
			method: 'GET',
			headers: {'User-Agent': userAgent},
			responseType: 'text',
			timeout: this.options.timeout || 30000
		})
		.then(response => {
			let groups = parseStarnetPage(response.data);
			if (groups.length === 0) {
				throw new Error('no groups parsed (starnet.php layout changed?)');
			}
			this.setGroups(groups);
			this.loggedFetchFailure = false;
			this.dump(groups);
			console.log(`D-STAR group directory: ${groups.length} QuadNet Smart Groups`);
		})
		.catch(err => {
			// Keep the previous (dump- or static-seeded) map; only log once per failure episode
			// so a down/changed page doesn't spam the log
			if (!this.loggedFetchFailure) {
				console.error(`D-STAR group directory: refresh failed, keeping previous data (${this.subscribeMap.size} groups): ${err}`);
				this.loggedFetchFailure = true;
			}
		});
	}

	dump(groups) {
		try {
			fs.writeFileSync(this.options.dumpFile, JSON.stringify(groups), {encoding: 'utf8'});
		} catch (e) {
			console.error(`D-STAR group directory: failed to write dump file ${this.options.dumpFile}: ${e}`);
		}
	}
}

// Exposed for offline testing (test/dstar_groups.test.js).
DstarGroupDirectory.parseStarnetPage = parseStarnetPage;

module.exports = DstarGroupDirectory;
