/*
	Standalone test for the D-STAR presence receiver (no database needed).

	Requires HAMALERT_CONFIG to point at a config file, e.g.:
	  HAMALERT_CONFIG=./config-local.js node tools/dstarTest.js ...

	Live feeds:   node tools/dstarTest.js [--quadnet-only|--ircddb-only] [--connect-proxy http://host:port]
	Offline file: node tools/dstarTest.js --file <saved QuadNet ics log or ircDDB "N:record" lines>
	Offline page: node tools/dstarTest.js --dstarusers-file <saved dstarusers.org lastheard.php page>
	              (e.g. tools/fixtures/dstarusers-lastheard.html)

	Reflector link directory (see dstar_links.js):
	  --links REF030,REF058          Live: build the directory watching exactly these reflectors
	                                  (in addition to config.dstar.reflectorLinks.alwaysWatch), wait
	                                  for its first refresh, then run the feeds as usual so spots
	                                  get enriched with a dashboard-resolved reflector.
	  --links-file <html|json> <path> <REF>
	                                  Offline: parse a saved dashboard body (a fixture, e.g. under
	                                  tools/fixtures/reflectors/) as the given reflector and print
	                                  the resulting node -> reflector map. Combine with --file or
	                                  --dstarusers-file to enrich that replay from this offline
	                                  directory instead of printing and exiting.

	Prints every spot the receiver would emit. With --file or --dstarusers-file, priming and
	max-age checks are disabled so that all events in the file are shown (subject to deduplication).
*/
const DstarReceiver = require('../dstar');
const ReflectorLinkDirectory = require('../dstar_links');
const config = require('../config_loader');
const fs = require('fs');
const readline = require('readline');

let args = process.argv.slice(2);
let options = {};
let file = null;
let dstarusersFile = null;
let liveLinks = null;
let linksFile = null;

for (let i = 0; i < args.length; i++) {
	switch (args[i]) {
		case '--quadnet-only':
			options.ircddb = {disabled: true};
			break;
		case '--ircddb-only':
			options.quadnet = {disabled: true};
			break;
		case '--connect-proxy':
			options.ircddb = Object.assign({}, config.dstar.ircddb, {connectProxy: args[++i]});
			break;
		case '--file':
			file = args[++i];
			break;
		case '--dstarusers-file':
			dstarusersFile = args[++i];
			break;
		case '--links':
			liveLinks = args[++i];
			break;
		case '--links-file':
			linksFile = {type: args[++i], path: args[++i], ref: (args[++i] || '').toUpperCase()};
			break;
		default:
			console.error(`Unknown argument: ${args[i]}`);
			process.exit(1);
	}
}

// A tiny stand-in for ReflectorLinkDirectory, built directly from one offline-parsed dashboard
// body instead of by polling. Exposes the same synchronous lookup(node) contract.
function buildOfflineLinkDirectory(spec) {
	let body = fs.readFileSync(spec.path, {encoding: 'utf8'});
	let entries = (spec.type === 'json')
		? ReflectorLinkDirectory.parseJsonGateways(JSON.parse(body))
		: ReflectorLinkDirectory.parseClassicHtml(body);

	let map = new Map();
	for (let [key, module] of entries) {
		map.set(key, {reflector: `${spec.ref}-${module}`, source: 'dashboard'});
	}

	return {
		entries,
		lookup(node) {
			if (!node) {
				return null;
			}
			let hit = map.get(node);
			if (!hit) {
				let call = node.split('-')[0];
				if (call !== node) {
					hit = map.get(call);
				}
			}
			return hit || null;
		}
	};
}

function printOfflineMap(spec, directory) {
	console.log(`${directory.entries.size} node(s) linked to ${spec.ref} (from ${spec.path}):`);
	for (let [key, module] of directory.entries) {
		console.log(`  ${key} -> ${spec.ref}-${module}`);
	}
}

function runMain() {
	let stats = {records: 0, spots: 0, byEvent: {}};
	let receiver = new DstarReceiver((file || dstarusersFile) ? Object.assign(options, {maxAge: 0}) : options);
	receiver.on('spot', spot => {
		stats.spots++;
		stats.byEvent[spot.dvEvent] = (stats.byEvent[spot.dvEvent] || 0) + 1;
		console.log(`SPOT ${spot.rawText}`);
		if (process.env.VERBOSE) {
			console.dir(spot);
		}
	});

	if (dstarusersFile) {
		let html = fs.readFileSync(dstarusersFile, {encoding: 'utf8'});
		let records = DstarReceiver.parseDstarusersPage(html).reverse();	// chronological (oldest first)
		for (let record of records) {
			stats.records++;
			receiver.processRecord(record, false);
		}
		console.log(`\n${stats.records} records, ${stats.spots} spots: ${JSON.stringify(stats.byEvent)}`);
	} else if (file) {
		let rl = readline.createInterface({input: fs.createReadStream(file)});
		rl.on('line', line => {
			let record = DstarReceiver.parseQuadnetLine(line) || DstarReceiver.parseIrcddbLine(line);
			if (record) {
				stats.records++;
				receiver.processRecord(record, false);
			}
		});
		rl.on('close', () => {
			console.log(`\n${stats.records} records, ${stats.spots} spots: ${JSON.stringify(stats.byEvent)}`);
		});
	} else {
		receiver.start();
		console.log("Listening to live feeds, press Ctrl-C to stop");
		process.on('SIGINT', () => {
			receiver.stop();
			if (options.linkDirectory && options.linkDirectory.stop) {
				options.linkDirectory.stop();
			}
			console.log(`\n${stats.spots} spots: ${JSON.stringify(stats.byEvent)}`);
			process.exit(0);
		});
	}
}

if (linksFile) {
	let directory = buildOfflineLinkDirectory(linksFile);
	if (!file && !dstarusersFile) {
		// Offline, print-only mode: just show the parsed map.
		printOfflineMap(linksFile, directory);
		process.exit(0);
	}
	// Combined with a replay: enrich it from this offline-parsed dashboard instead of printing.
	options.linkDirectory = directory;
	runMain();
} else if (liveLinks) {
	let refs = liveLinks.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
	let linkOptions = Object.assign({}, config.dstar.reflectorLinks, {alwaysWatch: refs, disabled: false});
	let linkDirectory = new ReflectorLinkDirectory(linkOptions, () => Promise.resolve([]));
	options.linkDirectory = linkDirectory;
	console.log(`Watching reflector link tables for: ${refs.join(', ')} (waiting for first refresh)...`);
	linkDirectory.initialRefresh.then(() => runMain());
} else {
	runMain();
}
