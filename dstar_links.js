const axios = require('axios');
const fs = require('fs');
const path = require('path');

/*
	D-STAR reflector link directory

	D-STAR "heard" records (see dstar.js) often name only the repeater/hotspot module a
	callsign was heard on (e.g. "M3LEE active on GB7ME-B"), but that module may itself be
	linked to a DPlus REF reflector module (e.g. "GB7ME B" linked to "REF030 C"). A reflector
	trigger ("anyone on REF030") would otherwise miss that transmission entirely, because the
	heard record carries no reflector at all.

	Every DPlus REF reflector publishes its current link table ("Linked Gateways") on its own
	dashboard, normally at http://refNNN.dstargateway.org/. This module polls the dashboards of
	whichever REF reflectors are actually being watched (derived from trigger conditions, see
	watchedReflectorsFromTriggers() below, plus a fixed config.dstar.reflectorLinks.alwaysWatch list)
	and builds a single Map from repeater/hotspot node ("GB7ME-B") to the reflector module it is
	currently linked to ("REF030-C"). dstar.js's DstarReceiver consults this map (synchronously,
	see lookup() below) to fill in a missing dvReflector before a spot is built.

	A survey of all 57 REF reflectors that report to dstarusers.org found three dashboard
	shapes worth reading (see the readers design below), one WebSocket-only reflector with no
	usable HTTP interface (REF016, marked "unsupported"), and five reflectors unreachable at
	survey time - none of those five need a reader, they simply have no data to fetch today.

	- CLASSIC (the vast majority, 50/57): a static server-rendered HTML page with a "Linked
	  Gateways" table, one column per module (Module A..E), each populated cell holding
	  "<callsign>  <module>" (the linked gateway/repeater's own callsign and module). REF020's
	  classic table lives one hop deeper, behind an HTML frameset - handled generically (see
	  fetchHtml below) as well as with an explicit override, for documentation.
	- JSON (REF075 only): a small JSON REST endpoint (a "DREFD" reflector daemon) with a
	  `gateways: [{callsign, module}]` array.
	- unsupported (REF016 only): WebSocket-push only, no HTTP fallback at all. Configured via
	  readerOverrides.REF016 = {type: 'unsupported'} so it is watched (if a trigger names it) but
	  never fetched.

	Refresh is on a timer (config.dstar.reflectorLinks.refreshInterval), fetches run with bounded
	concurrency (maxConcurrent), and a fetch failure for one reflector never affects any other:
	the previous table for that reflector is kept, a per-reflector backoff (failureBackoff)
	prevents hammering a down dashboard, and at most one log line is printed per failure episode
	(cleared again on the next success). Nothing here ever throws out of refresh() - a broken
	getWatchedReflectors() callback, a hung dashboard, a connection refused, or a bad HTTP status
	all just leave the previous data in place.

	Like dstar_nodes.js, the merged map is persisted to options.dumpFile so a restart has data
	immediately, without waiting for the first refresh.
*/

const userAgent = 'HamAlert/1.0 (+https://hamalert.org)';

const moduleHeaderTexts = ['MODULE A', 'MODULE B', 'MODULE C', 'MODULE D', 'MODULE E'];

const refReflectorRegex = /^REF\d{3}$/;

// A populated "Linked Gateways" cell, once cleaned: the linked node's callsign and its own
// module letter, e.g. "GB7ME  B" -> {call: 'GB7ME', module: 'B'}
const linkedCellRegex = /^([A-Z0-9]+)\s+([A-Z])$/i;

function htmlUnescape(text) {
	return text
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;/gi, "'");
}

// Strip tags, unescape entities, and collapse whitespace (incl. non-breaking spaces) in an HTML table cell
function cleanCell(html) {
	return htmlUnescape(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// Find the offset of a "Module A".."Module E" run of 5 consecutive cells within a header row's
// cleaned cell texts (there may be extra leading columns, e.g. a "#" row-number column).
// Returns -1 if not found.
function findModuleColumnOffset(cells) {
	for (let i = 0; i + moduleHeaderTexts.length <= cells.length; i++) {
		let matches = true;
		for (let j = 0; j < moduleHeaderTexts.length; j++) {
			if ((cells[i + j] || '').toUpperCase() !== moduleHeaderTexts[j]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			return i;
		}
	}
	return -1;
}

function extractCells(rowHtml) {
	let cells = [];
	let cellRegex = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
	let cellMatches;
	while ((cellMatches = cellRegex.exec(rowHtml)) !== null) {
		cells.push(cleanCell(cellMatches[1]));
	}
	return cells;
}

/*
	Parse a classic DPlus-style "Linked Gateways" table out of an HTML page: find the header row
	whose cells contain a "Module A".."Module E" run (ignoring any extra leading columns, e.g.
	REF032's "#" row-number column), then read every following row of that same table.

	Returns a Map from linked node ("GB7ME-B") to the reflector's own module letter it is linked
	under ("C"). An empty or missing table (REF029) yields an empty Map, never an error/null.
*/
function parseClassicHtml(html) {
	let entries = new Map();
	let rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
	let headerOffset = -1;
	let tableBody = null;
	let match;

	while ((match = rowRegex.exec(html)) !== null) {
		let cells = extractCells(match[1]);
		let offset = findModuleColumnOffset(cells);
		if (offset >= 0) {
			headerOffset = offset;
			let tableEnd = html.indexOf('</table>', rowRegex.lastIndex);
			tableBody = html.slice(rowRegex.lastIndex, tableEnd === -1 ? html.length : tableEnd);
			break;
		}
	}

	if (headerOffset < 0 || tableBody === null) {
		return entries;	// no recognizable "Linked Gateways" table on this page
	}

	let dataRowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
	let rowMatch;
	while ((rowMatch = dataRowRegex.exec(tableBody)) !== null) {
		let cells = extractCells(rowMatch[1]);
		for (let i = 0; i < moduleHeaderTexts.length; i++) {
			let cellText = cells[headerOffset + i];
			if (!cellText) {
				continue;
			}
			let cellMatches = linkedCellRegex.exec(cellText);
			if (!cellMatches) {
				continue;
			}
			let call = cellMatches[1].toUpperCase();
			let ownModule = cellMatches[2].toUpperCase();
			let columnModule = String.fromCharCode(65 + i);	// A, B, C, D, E
			entries.set(`${call}-${ownModule}`, columnModule);
		}
	}
	return entries;
}

const framesetRegex = /<frameset\b/i;
const frameSrcRegex = /<frame\b[^>]*\bsrc\s*=\s*["']([^"']*status\.html)["']/i;

// If the page is a frameset wrapper (REF020) with a frame pointing at a "status.html" page,
// return that frame's absolute URL (resolved against the page's own URL); otherwise null.
function findFramesetUrl(html, pageUrl) {
	if (!framesetRegex.test(html)) {
		return null;
	}
	let frameMatches = frameSrcRegex.exec(html);
	if (!frameMatches) {
		return null;
	}
	try {
		return new URL(frameMatches[1], pageUrl).toString();
	} catch (e) {
		return null;
	}
}

/*
	Parse a DREFD-style JSON dashboard payload (REF075): {gateways: [{callsign, module}, ...]}.

	NOTE on `module`: the survey could not determine, from a live payload alone, whether this is
	the linked gateway's own module or the reflector's module (as printed live, REF075's gateways
	were single-module hotspots where the two are usually the same letter, so it couldn't be
	told apart). We treat it as the REFLECTOR's module (consistent with the classic reader's
	column meaning) and record the node by CALLSIGN ONLY (e.g. "EA5RKD", not "EA5RKD-B"), so a
	lookup of "EA5RKD-B" still matches on the callsign part (see lookup() below) even though we
	don't actually know that EA5RKD's own module is B.

	Returns a Map from callsign to the reflector's module letter. A missing/malformed
	`gateways` array yields an empty Map.
*/
function parseJsonGateways(data) {
	let entries = new Map();
	let gateways = data && Array.isArray(data.gateways) ? data.gateways : [];
	for (let gateway of gateways) {
		if (!gateway || typeof gateway.callsign !== 'string' || typeof gateway.module !== 'string') {
			continue;
		}
		let call = gateway.callsign.trim().toUpperCase();
		let module = gateway.module.trim().toUpperCase();
		if (!call || !module) {
			continue;
		}
		entries.set(call, module);
	}
	return entries;
}

function httpGet(url, timeout, responseType) {
	return axios({
		url,
		method: 'GET',
		headers: {'User-Agent': userAgent},
		responseType,
		timeout
	}).then(response => response.data);
}

// Run fn(item) over items with at most `limit` in flight at once. fn is expected to never
// reject (any per-item failure should be handled inside fn); this never rejects either.
function mapWithConcurrency(items, limit, fn) {
	return new Promise(resolve => {
		if (items.length === 0) {
			resolve();
			return;
		}
		let nextIndex = 0;
		let active = 0;
		let completed = 0;

		function launch() {
			while (active < limit && nextIndex < items.length) {
				let item = items[nextIndex++];
				active++;
				Promise.resolve().then(() => fn(item))
					.catch(() => {})
					.then(() => {
						active--;
						completed++;
						if (completed === items.length) {
							resolve();
						} else {
							launch();
						}
					});
			}
		}
		launch();
	});
}

class ReflectorLinkDirectory {
	// options: config.dstar.reflectorLinks. getWatchedReflectors: () => Promise<string[]> of
	// base REF callsigns (no module), e.g. ['REF030', 'REF058'].
	constructor(options, getWatchedReflectors) {
		this.options = options || {};
		this.getWatchedReflectorsFn = getWatchedReflectors || (() => Promise.resolve([]));

		this.tables = new Map();		// REF -> {entries: Map(node/callsign -> module), fetchedAt}
		this.nodeIndex = new Map();	// flattened lookup map, rebuilt whenever this.tables changes
		this.backoffUntil = new Map();	// REF -> timestamp before which we won't retry after a failure
		this.failureLogged = new Set();	// REFs for which the current failure episode has already been logged
		this.timer = null;

		if (this.options.dumpFile && fs.existsSync(this.options.dumpFile)) {
			try {
				let raw = JSON.parse(fs.readFileSync(this.options.dumpFile, {encoding: 'utf8'}));
				this.tables = new Map(raw.map(([ref, table]) => [ref, {entries: new Map(table.entries), fetchedAt: table.fetchedAt}]));
				this.rebuildIndex();
				console.log(`D-STAR reflector links: loaded ${this.tables.size} reflectors (${this.nodeIndex.size} nodes) from ${this.options.dumpFile}`);
			} catch (e) {
				console.error(`D-STAR reflector links: failed to read dump file ${this.options.dumpFile}: ${e}`);
			}
		}

		if (!this.options.disabled) {
			// Exposed so callers (tools/dstarTest.js, tests) can wait for the first refresh to finish.
			this.initialRefresh = this.refresh();
			this.timer = setInterval(() => this.refresh(), this.options.refreshInterval || 120000);
			this.timer.unref();	// don't keep a short-lived tool alive just for this
		} else {
			this.initialRefresh = Promise.resolve();
		}
	}

	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	// Which REF reflectors to watch for link-table changes: every distinct base REF callsign (no
	// module letter) named in any trigger's dvReflector condition. A condition value may be a
	// plain string or an array (either from how the trigger was saved, or from server.js's own
	// matcher-side normalization); either way we only want bare "REFnnn" values, uppercased and
	// with any "-X" module letter stripped.
	static watchedReflectorsFromTriggers(db) {
		if (!db) {
			return Promise.resolve([]);
		}
		return db.collection('triggers').distinct('conditions.dvReflector')
		.then(values => {
			let refs = new Set();
			for (let value of values) {
				for (let item of (Array.isArray(value) ? value : [value])) {
					if (typeof item !== 'string') {
						continue;
					}
					let base = item.toUpperCase().split('-')[0];
					if (refReflectorRegex.test(base)) {
						refs.add(base);
					}
				}
			}
			return Array.from(refs);
		})
		.catch(err => {
			console.error(`D-STAR reflector links: failed to query watched reflectors from triggers: ${err}`);
			return [];
		});
	}

	// Synchronous, pure Map lookup - never does I/O and never throws. Returns
	// {reflector: 'REF030-C', source: 'dashboard'} or null.
	lookup(node) {
		if (!node) {
			return null;
		}
		let hit = this.nodeIndex.get(node);
		if (!hit) {
			let call = node.split('-')[0];
			if (call !== node) {
				hit = this.nodeIndex.get(call);
			}
		}
		return hit ? {reflector: hit.reflector, source: hit.source} : null;
	}

	// Reader config for one reflector: an override from options.readerOverrides, or the default
	// classic HTML reader against options.urlTemplate with "{ref}" replaced by the lowercased callsign.
	readerConfigFor(ref) {
		let override = (this.options.readerOverrides && this.options.readerOverrides[ref]) || {};
		let type = override.type || 'html';
		let url = override.url || (this.options.urlTemplate || 'http://{ref}.dstargateway.org/').replace('{ref}', ref.toLowerCase());
		return {type, url};
	}

	// Fetch and parse one reflector's link table. Resolves to a Map(node/callsign -> module),
	// or null for a reader marked "unsupported" (nothing to fetch). Rejects on any fetch/parse
	// failure; callers must catch.
	fetchReflector(ref) {
		let reader = this.readerConfigFor(ref);
		let timeout = this.options.timeout || 10000;

		if (reader.type === 'unsupported') {
			return Promise.resolve(null);
		}

		if (reader.type === 'json') {
			return httpGet(reader.url, timeout, 'json').then(data => parseJsonGateways(data));
		}

		// Default: classic HTML, generically following a frameset wrapper (REF020) if present.
		return httpGet(reader.url, timeout, 'text').then(body => {
			let frameUrl = findFramesetUrl(body, reader.url);
			if (frameUrl) {
				return httpGet(frameUrl, timeout, 'text').then(body2 => parseClassicHtml(body2));
			}
			return parseClassicHtml(body);
		});
	}

	// Fetch+merge one reflector; never rejects (failures are handled and logged internally).
	refreshOne(ref) {
		return this.fetchReflector(ref)
			.then(entries => {
				this.backoffUntil.delete(ref);
				this.failureLogged.delete(ref);
				if (entries === null) {
					return;	// unsupported reader: watched, but nothing to fetch or merge
				}
				this.tables.set(ref, {entries, fetchedAt: Date.now()});
				this.rebuildIndex();
			})
			.catch(err => {
				this.backoffUntil.set(ref, Date.now() + (this.options.failureBackoff || 600000));
				if (!this.failureLogged.has(ref)) {
					console.error(`D-STAR reflector links: ${ref} fetch failed, keeping previous data (${err && err.message || err})`);
					this.failureLogged.add(ref);
				}
				// Keep whatever this.tables already has for ref (or nothing, if it was never fetched)
			});
	}

	// Rebuild the flattened node->reflector index from this.tables. A node claimed by more than
	// one reflector's table resolves to whichever table was fetched most recently.
	rebuildIndex() {
		let newIndex = new Map();
		let sorted = Array.from(this.tables.entries()).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
		for (let [ref, table] of sorted) {
			for (let [key, module] of table.entries) {
				newIndex.set(key, {reflector: `${ref}-${module}`, source: 'dashboard'});
			}
		}
		this.nodeIndex = newIndex;
	}

	// Never throws and never leaves a rejected promise unhandled: a broken getWatchedReflectors
	// callback, a hung/unreachable dashboard, or a bad HTTP status all just keep previous data.
	refresh() {
		return Promise.resolve()
			.then(() => this.getWatchedReflectorsFn())
			.catch(err => {
				console.error(`D-STAR reflector links: failed to get watched-reflector list, skipping this refresh (${err && err.message || err})`);
				return [];
			})
			.then(watched => {
				let always = this.options.alwaysWatch || [];
				let all = Array.from(new Set([...(Array.isArray(watched) ? watched : []), ...always]));

				let now = Date.now();
				let toFetch = all.filter(ref => {
					let backoff = this.backoffUntil.get(ref);
					return !backoff || backoff <= now;
				});

				return mapWithConcurrency(toFetch, this.options.maxConcurrent || 3, ref => this.refreshOne(ref));
			})
			.then(() => {
				this.dump();
				console.log(`D-STAR reflector links: ${this.tables.size} reflectors, ${this.nodeIndex.size} linked nodes`);
			})
			.catch(err => {
				// Should be unreachable (everything above already catches), but refresh() must
				// never reject - it drives a setInterval loop and is awaited by tools/tests.
				console.error(`D-STAR reflector links: refresh failed unexpectedly: ${err}`);
			});
	}

	dump() {
		if (!this.options.dumpFile) {
			return;
		}
		try {
			let dir = path.dirname(this.options.dumpFile);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, {recursive: true});
			}
			let raw = Array.from(this.tables.entries()).map(([ref, table]) => [ref, {entries: Array.from(table.entries.entries()), fetchedAt: table.fetchedAt}]);
			fs.writeFileSync(this.options.dumpFile, JSON.stringify(raw), {encoding: 'utf8'});
		} catch (e) {
			console.error(`D-STAR reflector links: failed to write dump file ${this.options.dumpFile}: ${e}`);
		}
	}
}

// Exposed for offline testing (tools/dstarTest.js --links-file, test/).
ReflectorLinkDirectory.parseClassicHtml = parseClassicHtml;
ReflectorLinkDirectory.parseJsonGateways = parseJsonGateways;
ReflectorLinkDirectory.findFramesetUrl = findFramesetUrl;
ReflectorLinkDirectory.refReflectorRegex = refReflectorRegex;
ReflectorLinkDirectory.linkedCellRegex = linkedCellRegex;

module.exports = ReflectorLinkDirectory;
