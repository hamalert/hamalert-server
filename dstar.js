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

	Repeater/node and reflector identifiers are normalized to "<callsign>-<module>" (e.g. W4HFH-C,
	REF030-C); the module letter is omitted if there is none.

	Both are normalized into "heard" records, classified into events and deduplicated:

	- active: a voice transmission (UR = CQCQCQ, area routing, or a link command that was
	  held long enough to be voice)
	- linked: a link command (UR = <reflector><module>L)

	Info/echo/unlink and other control commands never produce events.
*/

const feedUserAgent = 'HamAlert/1.0 (+https://hamalert.org)';

const callsignRegex = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}$/;
const linkCommandRegex = /^([A-Z0-9]{3,6}) {0,3}([A-Z])L$/;
const quadnetLineRegex = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s+([\d.]+)s:\s*(\d+)%:\s*([\d.]+)% (.{8})\/(.{4}) (.{8}) (.{8}) (.{8}) (.{20}) (.{8})$/;
const ircddbLineRegex = /^(\d+):(.{31,99})$/;
const ircddbStatsRegex = /^([\d.]+)s_S:(\d+)%_E:([\d.]+)%/;

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
		this.dedupeCache = new TTLCache({ttl: this.options.dedupeInterval});
		this.feeds = [];
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

	// Classify a heard record into zero or more events
	classify(record) {
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
		let key = `${record.my}|${event.type}|${event.node}|${event.reflector || ''}`;
		if (this.dedupeCache.has(key)) {
			return;
		}
		this.dedupeCache.set(key, true);

		if (priming) {
			return;	// only fill the dedupe cache with what was already in the log at startup
		}

		if (this.options.maxAge && (new Date() - record.time) > this.options.maxAge) {
			return;
		}

		let spot = {
			source: 'dstar',
			time: record.time.toISOString().substring(11, 16),
			date: record.time,
			fullCallsign: record.my,
			mode: 'dstar',
			dvEvent: event.type,
			dvNode: event.node,
			dvFeed: record.feed
		};

		if (event.reflector) {
			spot.dvReflector = event.reflector;
		}

		let gateway = formatNode(record.rpt2);
		if (gateway) {
			spot.spotter = gateway.split(' ')[0];
		}

		if (record.ext) {
			spot.dvSuffix = record.ext;
		}

		if (record.msg) {
			spot.comment = record.msg;
		}

		if (record.duration !== undefined) {
			spot.dvDuration = record.duration;
		}

		let where = spot.dvNode;
		if (spot.dvReflector) {
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

module.exports = DstarReceiver;
