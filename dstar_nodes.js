const axios = require('axios');
const fs = require('fs');
const config = require('./config_loader');

/*
	D-STAR node/reflector frequency directory

	D-STAR "heard" records (see dstar.js) carry the repeater/hotspot module (e.g. "W4HFH-C")
	but no frequency. Both QuadNet and ircDDB separately publish, for every module they know
	about, the frequency it is registered on:

	- QuadNet (https://www.openquad.net/gateway.php): an HTML table, one row per module, with
	  a "repeater" column that is an 8-character field: the callsign, underscore-padded, with
	  the module letter as the last character (e.g. "2E0CMS_B", "A62A___C").

	- ircDDB (https://status.ircddb.net/repeater.php): an HTML table of repeaters. The default
	  page only shows the most recent 30 entries, but it also prints "Total available records:
	  N" and accepts a "?n=N" query parameter that returns all of them in one page (there is no
	  need to walk the per-country "?ctry=XXX" links). Its "Repeater" column embeds the same
	  8-character underscore-padded callsign+module field inside a "/cgi-bin/ircddb-log?..."
	  link, and its "QRG/Offset (MHz)" column is a bare "<td>freq<br>offset</td>" cell.

	Both are parsed into a single Map, keyed by the normalized "CALL-MODULE" node identifier
	(the same format as spot.dvNode) to {frequency (MHz), offset (MHz), source}. QuadNet is
	preferred; ircDDB only fills in modules that QuadNet doesn't have.

	The map is refreshed every config.dstar.nodeLists.refreshInterval and persisted to
	config.dstar.nodeLists.dumpFile (like clublog.js's cache) so a restart has data immediately,
	without waiting for the first refresh.
*/

const userAgent = 'HamAlert/1.0 (+https://hamalert.org)';
const httpTimeout = 30000;

// Both QuadNet and ircDDB publish the node/reflector field the same way: the callsign,
// underscore-padded, with the module letter as the last character.
// "2E0CMS_B" -> {call: "2E0CMS", module: "B"}; "A62A___C" -> {call: "A62A", module: "C"}
const nodeFieldRegex = /^([A-Z0-9]+)(_*)([A-Z])$/;

function parseNodeField(field) {
	let matches = nodeFieldRegex.exec(field);
	if (!matches) {
		return null;
	}
	return {call: matches[1], module: matches[3]};
}

function normalizedKey(call, module) {
	return `${call}-${module}`;
}

class DstarNodeDirectory {
	constructor() {
		this.options = config.dstar.nodeLists;
		this.map = new Map();
		this.loggedFetchFailure = false;

		if (fs.existsSync(this.options.dumpFile)) {
			try {
				let entries = JSON.parse(fs.readFileSync(this.options.dumpFile, {encoding: 'utf8'}));
				this.map = new Map(entries);
				console.log(`D-STAR node directory: loaded ${this.map.size} modules from ${this.options.dumpFile}`);
			} catch (e) {
				console.error(`D-STAR node directory: failed to read dump file ${this.options.dumpFile}: ${e}`);
			}
		}

		this.refresh();
		setInterval(() => this.refresh(), this.options.refreshInterval);
	}

	// Look up a normalized node/reflector identifier (e.g. "W4HFH-C"). Returns
	// {frequency, offset, source} or null if not found.
	lookup(node) {
		if (!node) {
			return null;
		}
		return this.map.get(node) || null;
	}

	// Returns a promise that resolves once the refresh attempt has finished (whether it
	// succeeded or failed; failures are handled internally, see below).
	refresh() {
		return Promise.all([this.fetchQuadnet(), this.fetchIrcddb()])
		.then(([quadnetEntries, ircddbEntries]) => {
			let newMap = new Map();
			for (let [key, value] of quadnetEntries) {
				newMap.set(key, value);
			}

			let ircddbAdded = 0;
			for (let [key, value] of ircddbEntries) {
				if (!newMap.has(key)) {
					newMap.set(key, value);
					ircddbAdded++;
				}
			}

			this.map = newMap;
			this.loggedFetchFailure = false;
			this.dump();
			console.log(`D-STAR node directory: ${quadnetEntries.length} QuadNet + ${ircddbAdded} ircDDB modules`);
		})
		.catch(err => {
			// Keep the previous map; only log once per failure so a down feed doesn't spam the log
			if (!this.loggedFetchFailure) {
				console.error(`D-STAR node directory: refresh failed, keeping previous data (${this.map.size} modules): ${err}`);
				this.loggedFetchFailure = true;
			}
		});
	}

	fetchQuadnet() {
		return axios({
			url: this.options.quadnetUrl,
			method: 'GET',
			headers: {'User-Agent': userAgent},
			responseType: 'text',
			timeout: httpTimeout
		})
		.then(response => this.parseQuadnet(response.data));
	}

	// One row per <tr>: <td>repeater</td><td>frequency</td><td>offset</td>...
	parseQuadnet(html) {
		let entries = [];
		let rowRegex = /<tr><td><font size=1>([A-Z0-9_]{8})<\/td><td><font size=1>([\d.]*)<\/td><td><font size=1>([+-]?[\d.]*)<\/td>/g;
		let matches;
		while ((matches = rowRegex.exec(html)) !== null) {
			let node = parseNodeField(matches[1]);
			if (!node) {
				continue;
			}
			let frequency = parseFloat(matches[2]);
			if (!frequency) {
				continue;	// 0, NaN or blank: skip
			}
			let offset = parseFloat(matches[3]);
			entries.push([normalizedKey(node.call, node.module), {
				frequency,
				offset: isNaN(offset) ? undefined : offset,
				source: 'quadnet'
			}]);
		}
		return entries;
	}

	fetchIrcddb() {
		// The default page only shows the most recent 30 rows, but it prints the total record
		// count and accepts "?n=<count>" to return all of them in one page.
		return axios({
			url: this.options.ircddbUrl,
			method: 'GET',
			headers: {'User-Agent': userAgent},
			responseType: 'text',
			timeout: httpTimeout
		})
		.then(response => {
			let total = 10000;
			let totalMatches = /Total available records:\s*(\d+)/.exec(response.data);
			if (totalMatches) {
				total = parseInt(totalMatches[1]);
			}

			return axios({
				url: this.options.ircddbUrl,
				method: 'GET',
				params: {n: total},
				headers: {'User-Agent': userAgent},
				responseType: 'text',
				timeout: httpTimeout
			});
		})
		.then(response => this.parseIrcddb(response.data));
	}

	// One row per <tr bgcolor="...">; the repeater field is embedded in an
	// "ircddb-log?..." link, and the QRG/offset field is a bare <td>freq<br>offset</td> cell
	// (the lat/long and range/AGL cells are similarly shaped but wrapped in an <a> tag).
	parseIrcddb(html) {
		let entries = [];
		let rowRegex = /<tr bgcolor="#f0f0[af]0">(.*?)<\/tr>/gs;
		let repeaterRegex = /ircddb-log\?[^"]*?([A-Z0-9_]{8})"/;
		let qrgRegex = /<td>\s*([\d.]+)<br>\s*([+-]?[\d.]+)\s*<\/td>/;
		let matches;
		while ((matches = rowRegex.exec(html)) !== null) {
			let row = matches[1];
			let repeaterMatches = repeaterRegex.exec(row);
			let qrgMatches = qrgRegex.exec(row);
			if (!repeaterMatches || !qrgMatches) {
				continue;
			}
			let node = parseNodeField(repeaterMatches[1]);
			if (!node) {
				continue;
			}
			let frequency = parseFloat(qrgMatches[1]);
			if (!frequency) {
				continue;
			}
			let offset = parseFloat(qrgMatches[2]);
			entries.push([normalizedKey(node.call, node.module), {
				frequency,
				offset: isNaN(offset) ? undefined : offset,
				source: 'ircddb'
			}]);
		}
		return entries;
	}

	dump() {
		try {
			fs.writeFileSync(this.options.dumpFile, JSON.stringify(Array.from(this.map.entries())), {encoding: 'utf8'});
		} catch (e) {
			console.error(`D-STAR node directory: failed to write dump file ${this.options.dumpFile}: ${e}`);
		}
	}
}

module.exports = DstarNodeDirectory;
