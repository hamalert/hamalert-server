const config = require('./config_loader');
const EventEmitter = require('events');
const axios = require('axios');
const http = require('http');
const TTLCache = require('@isaacs/ttlcache');

/*
	D-STAR presence receiver

	This is not a "spot" source in the DX sense; it reports presence: a callsign becoming
	active on (or linking to) a D-STAR repeater module or reflector module.

	Data sources (both are the public "last heard" logs fed by ircDDB-style gateways):

	- QuadNet heard log (https://www.openquad.net/ics/ics)
	  Plain text file, one line per completed transmission, tailed with HTTP Range requests.
	  Example line:
	  2026-09-09 16:22:23    9.16s:  0%: 0.0% DO7DAD__/ID52 REF098DL DB0BI__B DB0BI__G ICOM_ID_52_PLUS_60__ REF098_D

	- ircDDB live log (http://live.ircddb.net:8080/jj3.yaws?p=N)
	  Numbered fixed-width records ("N:<99 chars>"), polled with the last line number seen.
	  Each transmission produces a header record (type flag 0/2, carries the TX message) at
	  key-up and a stats record (type flag 1, carries duration/silence/BER) at key-off.
	  Example: 0:20260910000648N8IK____W4HFH__C1W4HFH__GCQCQCQ__000000970000________143.0s_S:0%_E:0.0%__

	- dstarusers.org last heard page (https://www.dstarusers.org/lastheard.php)
	  Static HTML table (refreshed by DStarMonitor agents on DPlus REF reflectors and Icom
	  gateways), polled and diffed against a watermark of previously-seen rows since the page
	  has no offset/line-number mechanism. Unlike the other two sources this only carries
	  presence directly (no UR/routing field to classify), so each row maps straight to a
	  single "active" event; there is no "linked" event and no voice-duration filtering.
	  A reporting node with no module letter (e.g. "REF030 Dongle User") is a DPlus/dongle/
	  hotspot login, not a transmission: the reflector has no way to know which module a
	  merely-listening user is on. These rows are dropped entirely (see parseDstarusersNode);
	  when such a user transmits, a proper module row follows (e.g. "REF030 C ...") and is
	  reported as usual.

	Repeater/node and reflector identifiers are normalized to "<callsign>-<module>" (e.g. W4HFH-C,
	REF030-C); the module letter is omitted if there is none.

	Both are normalized into "heard" records, classified into events and deduplicated:

	- active: a voice transmission (UR = CQCQCQ, area routing, or a link command that was
	  held long enough to be voice)
	- linked: a link command (UR = <reflector><module>L)

	Info/echo/unlink and other control commands never produce events.

	Heard records carry the repeater/hotspot module (dvNode, e.g. "W4HFH-C") but no frequency.
	Frequency/band are not resolved here: server.js's normalizeSpot() looks dvNode up in the
	QuadNet/ircDDB node directory (dstar_nodes.js) so that simulated spots benefit from the same
	logic as live ones.
*/

const feedUserAgent = 'HamAlert/1.0 (+https://hamalert.org)';

const callsignRegex = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}$/;
const linkCommandRegex = /^([A-Z0-9]{3,6}) {0,3}([A-Z])L$/;
const quadnetLineRegex = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s+([\d.]+)s:\s*(\d+)%:\s*([\d.]+)% (.{8})\/(.{4}) (.{8}) (.{8}) (.{8}) (.{20}) (.{8})$/;
const ircddbLineRegex = /^(\d+):(.{31,99})$/;
const ircddbStatsRegex = /^([\d.]+)s_S:(\d+)%_E:([\d.]+)%/;

// dstarusers.org lastheard.php parsing (see DstarusersFeed below)
const dstarusersRowRegex = /<tr class="rowres[12]">(.*?)<\/tr>/gs;
const dstarusersCellRegex = /<td>(.*?)<\/td>/gs;
const dstarusersTimeRegex = /^(\d\d)\/(\d\d)\/(\d\d) (\d\d):(\d\d):(\d\d) UTC$/;
const dstarusersCallsignRegex = /^(\S+)(?:\s+(\S+))?$/;
// "REF030 C 2 Meters", "REF030 Dongle User", "NS9RC B 440 MHz" (trailing " DVD" already stripped)
const dstarusersNodeRegex = /^(\S+)(?:\s+([A-Z]))?\s+(.+)$/;
const dstarusersReflectorPrefixRegex = /^(?:REF|XRF|DCS|XLX)/;
// D-STAR's "1.2 GHz"/"440 MHz"/"2 Meters" module bands, as printed by dstarusers.org (which
// omits the space in "1.2GHz") or, per the module letter convention, spelled out ("23 cm" etc.)
const dstarusersBands = {
	'2METERS': '2m',
	'440MHZ': '70cm', '70CM': '70cm',
	'1.2GHZ': '23cm', '23CM': '23cm'
};

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

function parseDstarusersBand(text) {
	return dstarusersBands[text.replace(/\s+/g, '').toUpperCase()];
}

// Parse a "Reporting Node" cell into its callsign/module/band, and whether it names a
// reflector (REF/XRF/DCS/XLX) or a repeater/gateway. Returns null if unparseable, OR if the
// node has no module letter at all (e.g. "REF030 Dongle User", "W5FC Dongle User"): DStarMonitor
// reports a dongle/hotspot login this way, without a module, because the reflector/gateway has
// no way to know which module a merely-listening user is on - this is not a transmission and
// must not become a record. When such a user actually transmits, a proper module row follows
// (e.g. "REF030 C ...") and is parsed normally. So only two shapes survive here: a reflector
// module ("REF030 C 2 Meters" -> id "REF030-C", no node) and a repeater/gateway module
// ("NS9RC B 440 MHz" -> id "NS9RC-B", band from the text).
function parseDstarusersNode(text) {
	let stripped = text.replace(/\s+DVD$/i, '');
	let matches = dstarusersNodeRegex.exec(stripped);
	if (!matches) {
		return null;
	}
	let callsign = matches[1];
	let module = matches[2];
	if (!module) {
		return null;
	}
	let rest = matches[3];
	let isReflector = dstarusersReflectorPrefixRegex.test(callsign);
	return {
		id: `${callsign}-${module}`,
		isReflector,
		// The band text only means something for a repeater/gateway ("NS9RC B 440 MHz"); a
		// reflector module's label ("REF030 C 2 Meters") says nothing about the user's RF band
		band: isReflector ? undefined : parseDstarusersBand(rest)
	};
}

function cleanField(field) {
	return (field || '').replace(/_/g, ' ');
}

// "W4HFH  C" => "W4HFH-C", "REF048 B" => "REF048-B", "        " => null
function formatNode(field) {
	if (!field) {
		return null;
	}
	let callsign = field.substring(0, 7).trim();
	let module = field.substring(7, 8).trim();
	if (!callsign) {
		return null;
	}
	if (module) {
		return `${callsign}-${module}`;
	}
	return callsign;
}

class DstarReceiver extends EventEmitter {
	constructor(options) {
		super();
		this.options = Object.assign({}, config.dstar, options);
		// dedupeInterval 0 (local development) disables suppression entirely
		this.dedupeCache = this.options.dedupeInterval > 0 ? new TTLCache({ttl: this.options.dedupeInterval}) : null;
		if (!this.dedupeCache) {
			console.log('D-STAR dedupe is DISABLED (config.dstar.dedupeInterval = 0)');
		}
		this.feeds = [];
		// Optional ReflectorLinkDirectory (see dstar_links.js), passed in by server.js or a
		// tool; resolves a repeater/hotspot module to the reflector module it is currently
		// linked to, so a heard record with no reflector of its own can still be alerted on one.
		this.linkDirectory = this.options.linkDirectory || null;
	}

	start() {
		if (this.options.quadnet && !this.options.quadnet.disabled) {
			let feed = new QuadnetFeed(this.options.quadnet);
			feed.on('record', (record, priming) => this.processRecord(record, priming));
			feed.on('error', err => console.error(`D-STAR QuadNet feed error: ${err}`));
			feed.start();
			this.feeds.push(feed);
		}

		if (this.options.ircddb && !this.options.ircddb.disabled) {
			let feed = new IrcddbLiveFeed(this.options.ircddb);
			feed.on('record', (record, priming) => this.processRecord(record, priming));
			feed.on('error', err => console.error(`D-STAR ircDDB feed error: ${err}`));
			feed.start();
			this.feeds.push(feed);
		}

		if (this.options.dstarusers && !this.options.dstarusers.disabled) {
			let feed = new DstarusersFeed(this.options.dstarusers);
			feed.on('record', (record, priming) => this.processRecord(record, priming));
			feed.on('error', err => console.error(`D-STAR dstarusers feed error: ${err}`));
			feed.start();
			this.feeds.push(feed);
		}
	}

	stop() {
		for (let feed of this.feeds) {
			feed.stop();
		}
		this.feeds = [];
	}

	// Parse a QuadNet "ics" log line into a heard record (or null)
	static parseQuadnetLine(line) {
		let matches = quadnetLineRegex.exec(line);
		if (!matches) {
			return null;
		}

		return {
			feed: 'quadnet',
			time: new Date(matches[1].replace(' ', 'T') + 'Z'),
			duration: parseFloat(matches[2]),
			silence: parseInt(matches[3]),
			ber: parseFloat(matches[4]),
			my: cleanField(matches[5]).trim(),
			ext: cleanField(matches[6]).trim(),
			ur: cleanField(matches[7]),
			rpt1: cleanField(matches[8]),
			rpt2: cleanField(matches[9]),
			msg: cleanField(matches[10]).trim(),
			dest: cleanField(matches[11]),
			stats: true
		};
	}

	// Parse an ircDDB live log line ("N:<record>") into a heard record (or null)
	static parseIrcddbLine(line) {
		let matches = ircddbLineRegex.exec(line);
		if (!matches) {
			return null;
		}

		let rec = matches[2].padEnd(99, ' ');	// short records: heard without details, or without TX message
		let typeFlag = rec.substring(30, 31);
		let record = {
			feed: 'ircddb',
			lineNumber: parseInt(matches[1]),
			time: new Date(`${rec.substring(0, 4)}-${rec.substring(4, 6)}-${rec.substring(6, 8)}T${rec.substring(8, 10)}:${rec.substring(10, 12)}:${rec.substring(12, 14)}Z`),
			my: cleanField(rec.substring(14, 22)).trim(),
			ext: cleanField(rec.substring(53, 57)).trim(),
			ur: cleanField(rec.substring(39, 47)),
			rpt1: cleanField(rec.substring(22, 30)),
			rpt2: cleanField(rec.substring(31, 39)),
			dest: cleanField(rec.substring(59, 67)),
			unregistered: (typeFlag === '2'),
			stats: (typeFlag === '1')
		};

		let text = cleanField(rec.substring(67, 87)).trim();
		if (record.stats) {
			let statsMatches = ircddbStatsRegex.exec(rec.substring(67, 87));
			if (statsMatches) {
				record.duration = parseFloat(statsMatches[1]);
				record.silence = parseInt(statsMatches[2]);
				record.ber = parseFloat(statsMatches[3]);
			}
			record.msg = '';
		} else {
			record.msg = text;
		}

		return record;
	}

	// Parse a dstarusers.org lastheard.php page into heard records (newest first, as on the page).
	// Unparseable rows (header, nav table, anything not matching the expected shape) are skipped.
	static parseDstarusersPage(html) {
		let records = [];
		let rowMatches;
		dstarusersRowRegex.lastIndex = 0;
		while ((rowMatches = dstarusersRowRegex.exec(html)) !== null) {
			let cells = [];
			let cellMatches;
			dstarusersCellRegex.lastIndex = 0;
			while ((cellMatches = dstarusersCellRegex.exec(rowMatches[1])) !== null) {
				cells.push(cellMatches[1]);
			}
			if (cells.length !== 4) {
				continue;
			}
			let record = DstarReceiver.parseDstarusersRow(cells);
			if (record) {
				records.push(record);
			}
		}
		return records;
	}

	// Parse one dstarusers.org row (its 4 raw <td> cell contents) into a heard record (or null)
	static parseDstarusersRow(cells) {
		let callsignMatches = dstarusersCallsignRegex.exec(cleanCell(cells[0]));
		if (!callsignMatches) {
			return null;
		}
		let my = callsignMatches[1].toUpperCase();
		if (!callsignRegex.test(my)) {
			return null;
		}

		let timeMatches = dstarusersTimeRegex.exec(cleanCell(cells[1]));
		if (!timeMatches) {
			return null;
		}
		let time = new Date(Date.UTC(
			2000 + parseInt(timeMatches[3]), parseInt(timeMatches[1]) - 1, parseInt(timeMatches[2]),
			parseInt(timeMatches[4]), parseInt(timeMatches[5]), parseInt(timeMatches[6])
		));

		let node = parseDstarusersNode(cleanCell(cells[2]));
		if (!node) {
			return null;
		}

		let event = node.isReflector
			? {type: 'active', node: undefined, reflector: node.id}
			: {type: 'active', node: node.id, reflector: undefined};

		return {
			feed: 'dstarusers',
			time,
			my,
			ext: callsignMatches[2],
			// The Location column names the reporting node/reflector's own town, not the
			// operator's - meaningful for a repeater ("Vero Beach, Fl, USA" for NS9RC) but not
			// for a reflector module (that's just wherever the reflector server is hosted), so
			// only keep it for repeater rows.
			msg: node.isReflector ? undefined : cleanCell(cells[3]),
			band: node.band,
			nodeKey: node.id,
			events: [event]
		};
	}

	// Classify a heard record into zero or more events
	classify(record) {
		// dstarusers.org rows carry no UR/routing field to classify: each row is already a
		// single ready-made "active" event (see parseDstarusersRow above).
		if (record.feed === 'dstarusers') {
			return record.events || [];
		}

		let events = [];

		if (!callsignRegex.test(record.my)) {
			return events;	// masked (********), blank or bogus callsign
		}

		let node = formatNode(record.rpt1);
		if (!node) {
			return events;
		}

		let ur = record.ur;
		let command = ur.substring(7, 8);
		let urHead = ur.substring(0, 7).trim();
		let dest = formatNode(record.dest);
		let voiceMinDuration = this.options.minVoiceDuration;
		let isVoice = false;

		if (ur.startsWith('CQCQCQ')) {
			isVoice = true;
		} else if (urHead === '' && ['U', 'I', 'E'].includes(command)) {
			// unlink, info, echo: control traffic, never alert
			return events;
		} else if (linkCommandRegex.test(ur)) {
			// Link command, e.g. "REF048BL": always a "linked" event; also voice if held long enough
			let linkMatches = linkCommandRegex.exec(ur);
			let target = `${linkMatches[1]}-${linkMatches[2]}`;
			events.push({type: 'linked', node, reflector: target});
			if (!dest) {
				dest = target;
			}
			isVoice = true;
			voiceMinDuration = this.options.minVoiceDurationLinkCommand;
		} else if (ur.startsWith('/')) {
			// Area routing ("/W4HFH C"): voice to a repeater
			isVoice = true;
			if (!dest) {
				dest = formatNode(ur.substring(1, 8) + ' ');
			}
		} else if (callsignRegex.test(ur.trim())) {
			// Callsign routing (directed call)
			isVoice = !this.options.ignoreDirectedCalls;
		} else {
			// Other commands (VIS ON, etc.)
			return events;
		}

		if (isVoice) {
			if (record.duration === undefined || record.duration >= voiceMinDuration) {
				events.push({type: 'active', node, reflector: dest});
			}
		}

		return events;
	}

	processRecord(record, priming) {
		try {
			// Merge TX message from the ircDDB header record into its stats record
			if (record.feed === 'ircddb') {
				let pendingKey = `${record.my}|${record.rpt1}`;
				if (record.stats) {
					let pending = this.pendingHeaders.get(pendingKey);
					if (pending) {
						record.msg = pending.msg;
					}
				} else {
					this.pendingHeaders.set(pendingKey, {msg: record.msg});
				}
			}

			for (let event of this.classify(record)) {
				this.emitEvent(record, event, priming);
			}
		} catch (e) {
			console.error("Exception while processing D-STAR record", e);
		}
	}

	emitEvent(record, event, priming) {
		// Resolve a missing reflector from the link directory (see dstar_links.js) BEFORE the
		// dedupe key is computed and the spot is built, so a repeater-only report ("M3LEE heard
		// on GB7ME-B", GB7ME-B currently linked to REF030-C) dedupes and reads by reflector, the
		// same as if the reflector had been reported directly. A "linked" event always carries
		// its own reflector already, so this only ever applies to "active" events. Never let a
		// lookup failure break event processing.
		let linkSource = null;
		if (event.node && !event.reflector) {
			try {
				let link = this.linkDirectory && this.linkDirectory.lookup(event.node);
				if (link) {
					event.reflector = link.reflector;
					linkSource = link.source;
				}
			} catch (e) {
				console.error(`D-STAR reflector link lookup failed for ${event.node}: ${e}`);
			}
		}

		// One alert per callsign, event and *place*, regardless of which feed reported it. A
		// reflector event is keyed by the reflector callsign without its module, so the same
		// transmission seen by QuadNet ("REF030-C via N4EDO-B") and by dstarusers.org as a
		// module row ("REF030-C", no node) collapses into one.
		// Events without a reflector are keyed by the node (undefined for none, hence the || '').
		let place = event.reflector ? event.reflector.split('-')[0] : (event.node || '');
		let key = `${record.my}|${event.type}|${place}`;
		// Suppress repeats within dedupeInterval of the previous record's *own* time, not of
		// the time we saw it: at startup the feeds are primed with up to an hour of old records,
		// and those must only suppress alerts within their own window (a station heard 40
		// minutes before a restart must not stay silent for 15 minutes after it). This also
		// makes file replays (tools/dstarTest.js) behave like the live feeds.
		if (this.dedupeCache) {
			let previous = this.dedupeCache.get(key);
			if (previous !== undefined && (record.time - previous) < this.options.dedupeInterval) {
				return;
			}
			this.dedupeCache.set(key, record.time.getTime());
		}

		if (priming) {
			return;	// only fill the dedupe cache with what was already in the log at startup
		}

		if (this.options.maxAge && (new Date() - record.time) > this.options.maxAge) {
			return;
		}

		let spot = {
			// The source names the feed that reported this spot (quadnet/ircddb/dstarusers);
			// mode stays 'dstar' for all three so triggers/UI can treat D-STAR as one thing
			// while still being able to filter or display which feed saw it.
			source: record.feed,
			time: record.time.toISOString().substring(11, 16),
			date: record.time,
			fullCallsign: record.my,
			mode: 'dstar',
			dvEvent: event.type
		};

		// Omit dvNode entirely rather than setting it to undefined (a dstarusers.org reflector
		// row with no module has no node at all)
		if (event.node) {
			spot.dvNode = event.node;
		}
		if (event.reflector) {
			spot.dvReflector = event.reflector;
		}
		if (linkSource) {
			spot.dvReflectorSource = linkSource;
		}

		let gateway = formatNode(record.rpt2);
		if (gateway) {
			spot.spotter = gateway.split(' ')[0];
		} else if (record.feed === 'dstarusers') {
			// dstarusers.org has no separate gateway field; the reporting node/reflector itself
			// is the "spotter" (a REF reflector reports through itself, e.g. REF030)
			spot.spotter = (event.reflector || event.node).split('-')[0];
		}

		if (record.ext) {
			spot.dvSuffix = record.ext;
		}

		if (record.msg) {
			spot.comment = record.msg;
		}

		// dstarusers.org's reporting-node band text (see parseDstarusersNode); server.js's
		// normalizeSpot() only uses this when dvNode can't be resolved to a physical frequency
		if (record.band) {
			spot.band = record.band;
		}

		if (record.duration !== undefined) {
			spot.dvDuration = record.duration;
		}

		let where = spot.dvNode || spot.dvReflector;
		if (spot.dvNode && spot.dvReflector) {
			where = `${spot.dvReflector} via ${spot.dvNode}`;
		}

		if (event.type === 'linked') {
			spot.title = `D-STAR ${spot.fullCallsign} linked ${spot.dvNode} to ${spot.dvReflector}`;
			spot.rawText = `${spot.time} ${spot.fullCallsign} linked ${spot.dvNode} to ${spot.dvReflector}`;
		} else {
			spot.title = `D-STAR ${spot.fullCallsign} active on ${where}`;
			spot.rawText = `${spot.time} ${spot.fullCallsign} heard on ${where}`;
			if (spot.dvDuration !== undefined) {
				spot.rawText += ` (${spot.dvDuration}s)`;
			}
		}
		if (spot.comment) {
			spot.rawText += `: ${spot.comment}`;
		}
		spot.rawText += ` [${record.feed}]`;

		this.emit('spot', spot);
	}

	get pendingHeaders() {
		if (!this._pendingHeaders) {
			this._pendingHeaders = new TTLCache({ttl: this.options.headerMergeInterval || 600000});
		}
		return this._pendingHeaders;
	}
}

/*
	Tails the QuadNet "ics" log with HTTP Range requests.
	On start, the last tailBytes of the file are read and only used to prime the dedupe cache.
*/
class QuadnetFeed extends EventEmitter {
	constructor(options) {
		super();
		this.options = options;
		this.offset = null;
		this.partialLine = '';
	}

	start() {
		this.poll();
		this.timer = setInterval(() => this.poll(), this.options.pollInterval);
	}

	stop() {
		clearInterval(this.timer);
	}

	poll() {
		if (this.polling) {
			return;
		}
		this.polling = true;

		let priming = (this.offset === null);
		let range = priming ? `bytes=-${this.options.tailBytes}` : `bytes=${this.offset}-`;

		axios({
			url: this.options.url,
			method: 'GET',
			headers: {
				'User-Agent': feedUserAgent,
				'Range': range
			},
			responseType: 'arraybuffer',
			timeout: this.options.timeout,
			validateStatus: status => (status === 200 || status === 206 || status === 416)
		})
		.then(response => {
			let total = this.parseTotalSize(response.headers['content-range']);

			if (response.status === 416) {
				// Range not satisfiable: nothing new, unless the file shrank (rotated)
				if (total !== null && total < this.offset) {
					console.log(`D-STAR QuadNet log shrank (${this.offset} -> ${total}), resetting`);
					this.offset = total;
					this.partialLine = '';
				}
				return;
			}

			let data = Buffer.from(response.data);

			if (response.status === 200) {
				// Server ignored the range: treat as a full fetch, only prime from it
				priming = true;
				this.offset = data.length;
				this.partialLine = '';
				this.handleData(data, true, true);
				return;
			}

			if (priming) {
				this.offset = (total !== null) ? total : data.length;
				this.handleData(data, true, true);
				console.log(`D-STAR QuadNet feed primed at offset ${this.offset}`);
			} else {
				this.offset += data.length;
				this.handleData(data, false, false);
			}
		})
		.catch(err => {
			this.emit('error', err);
		})
		.then(() => {
			this.polling = false;
		});
	}

	parseTotalSize(contentRange) {
		if (!contentRange) {
			return null;
		}
		let matches = /\/(\d+)$/.exec(contentRange);
		return matches ? parseInt(matches[1]) : null;
	}

	handleData(data, priming, dropFirstPartial) {
		let text = this.partialLine + data.toString('utf8');
		let lines = text.split('\n');
		this.partialLine = lines.pop();

		if (dropFirstPartial) {
			lines.shift();	// the first line of a tail fetch is most likely incomplete
		}

		for (let line of lines) {
			let record = DstarReceiver.parseQuadnetLine(line.replace(/\r$/, ''));
			if (record) {
				this.emit('record', record, priming);
			} else if (line.trim() !== '') {
				console.log(`D-STAR QuadNet: no match: ${line}`);
			}
		}
	}
}

/*
	Polls the ircDDB live log (yaws script) with the last line number seen.
	The server returns the lines from p to the end if there are fewer than 100 of them,
	otherwise the last 100 lines (also when there is nothing new).
*/
class IrcddbLiveFeed extends EventEmitter {
	constructor(options) {
		super();
		this.options = options;
		this.next = null;
	}

	start() {
		this.poll();
		this.timer = setInterval(() => this.poll(), this.options.pollInterval);
	}

	stop() {
		clearInterval(this.timer);
	}

	poll() {
		if (this.polling) {
			return;
		}
		this.polling = true;

		let priming = (this.next === null);
		let url = `${this.options.url}?p=${priming ? 0 : this.next}`;

		this.fetch(url)
		.then(body => {
			let maxLineNumber = -1;
			let records = [];
			for (let line of body.split('\n')) {
				line = line.trim();
				let record = DstarReceiver.parseIrcddbLine(line);
				if (record) {
					records.push(record);
					maxLineNumber = Math.max(maxLineNumber, record.lineNumber);
				} else if (line !== '' && line !== 'err') {
					// the server repeats the last 100 lines when there is nothing new, so only log unseen ones
					let lineNumber = parseInt(line);
					if (priming || isNaN(lineNumber) || lineNumber >= this.next) {
						console.log(`D-STAR ircDDB: no match: ${line}`);
					}
				}
			}

			if (maxLineNumber < 0) {
				return;
			}

			if (priming) {
				for (let record of records) {
					this.emit('record', record, true);
				}
				this.next = maxLineNumber + 1;
				console.log(`D-STAR ircDDB feed primed at line ${this.next}`);
				return;
			}

			if (maxLineNumber + 1 < this.next - 1) {
				// Log restarted (numbers went backwards): skip what we cannot place
				console.log(`D-STAR ircDDB log restarted (${this.next} -> ${maxLineNumber + 1}), resetting`);
				this.next = maxLineNumber + 1;
				return;
			}

			for (let record of records) {
				if (record.lineNumber >= this.next) {
					this.emit('record', record, false);
				}
			}
			this.next = Math.max(this.next, maxLineNumber + 1);
		})
		.catch(err => {
			this.emit('error', err);
		})
		.then(() => {
			this.polling = false;
		});
	}

	// Plain HTTP GET, optionally through an HTTP CONNECT proxy (development environments)
	fetch(url) {
		if (!this.options.connectProxy) {
			return axios({
				url,
				method: 'GET',
				headers: {'User-Agent': feedUserAgent},
				responseType: 'text',
				timeout: this.options.timeout
			}).then(response => response.data);
		}

		return new Promise((resolve, reject) => {
			let target = new URL(url);
			let proxy = new URL(this.options.connectProxy);
			let connectReq = http.request({
				host: proxy.hostname,
				port: proxy.port,
				method: 'CONNECT',
				path: `${target.hostname}:${target.port || 80}`,
				timeout: this.options.timeout
			});
			connectReq.on('connect', (res, socket) => {
				if (res.statusCode !== 200) {
					socket.destroy();
					reject(new Error(`CONNECT failed: ${res.statusCode}`));
					return;
				}
				let req = http.request({
					host: target.hostname,
					port: target.port || 80,
					path: target.pathname + target.search,
					method: 'GET',
					headers: {'User-Agent': feedUserAgent, 'Host': target.host},
					createConnection: () => socket,
					timeout: this.options.timeout
				}, res => {
					let chunks = [];
					res.on('data', chunk => chunks.push(chunk));
					res.on('end', () => {
						socket.destroy();
						if (res.statusCode !== 200) {
							reject(new Error(`HTTP ${res.statusCode}`));
						} else {
							resolve(Buffer.concat(chunks).toString('utf8'));
						}
					});
				});
				req.on('error', reject);
				req.on('timeout', () => req.destroy(new Error('timeout')));
				req.end();
			});
			connectReq.on('error', reject);
			connectReq.on('timeout', () => connectReq.destroy(new Error('CONNECT timeout')));
			connectReq.end();
		});
	}
}

/*
	Polls the dstarusers.org lastheard.php page (a static HTML page, refreshed roughly every
	30s by DStarMonitor agents; no offset/line-number mechanism), and diffs it against a
	watermark of the rows seen on the previous poll so that unchanged rows aren't re-emitted.

	Rows for the same callsign/node/time can appear more than once across polls (the page
	simply reprints whatever DStarMonitor last reported), so the watermark is a Set of
	"time|callsign|node" keys for the rows seen on the *previous* poll only (rebuilt every
	poll, not accumulated) plus the newest row time seen, used as a small safety-margin cutoff
	(dstarusersCutoffSlack) so that a gap (e.g. a missed poll) can't cause very old rows still
	on the page to be treated as new.
*/
const dstarusersCutoffSlack = 5*60*1000;

class DstarusersFeed extends EventEmitter {
	constructor(options) {
		super();
		this.options = options;
		this.seenKeys = null;	// null until the first poll completes (priming)
		this.newestTime = null;
	}

	start() {
		this.poll();
		this.timer = setInterval(() => this.poll(), this.options.pollInterval);
	}

	stop() {
		clearInterval(this.timer);
	}

	poll() {
		if (this.polling) {
			return;
		}
		this.polling = true;

		axios({
			url: this.options.url,
			method: 'GET',
			headers: {'User-Agent': feedUserAgent},
			responseType: 'text',
			timeout: this.options.timeout
		})
		.then(response => this.handlePage(response.data))
		.catch(err => {
			this.emit('error', err);
		})
		.then(() => {
			this.polling = false;
		});
	}

	// Split out from poll() so tools/dstarTest.js can replay a saved page through the exact
	// same watermark logic.
	handlePage(html) {
		let records = DstarReceiver.parseDstarusersPage(html);	// newest first, as on the page
		let priming = (this.seenKeys === null);
		let cutoff = (!priming && this.newestTime) ? new Date(this.newestTime.getTime() - dstarusersCutoffSlack) : null;

		let newSeenKeys = new Set();
		let newestTime = this.newestTime;
		let toEmit = [];

		for (let record of records) {
			let key = `${record.time.getTime()}|${record.my}|${record.nodeKey}`;
			newSeenKeys.add(key);

			if (!newestTime || record.time > newestTime) {
				newestTime = record.time;
			}

			if (priming || (cutoff && record.time < cutoff) || this.seenKeys.has(key)) {
				continue;
			}

			toEmit.push(record);
		}

		// Emit in chronological order (oldest first); the page lists rows newest first.
		toEmit.reverse();
		for (let record of toEmit) {
			this.emit('record', record, false);
		}

		if (priming) {
			let primingRecords = records.slice().reverse();
			for (let record of primingRecords) {
				this.emit('record', record, true);
			}
			console.log(`D-STAR dstarusers feed primed with ${records.length} rows`);
		}

		this.seenKeys = newSeenKeys;
		this.newestTime = newestTime;
	}
}

module.exports = DstarReceiver;
