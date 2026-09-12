/*
	Standalone test for the D-STAR presence receiver (no database needed).

	Requires HAMALERT_CONFIG to point at a config file, e.g.:
	  HAMALERT_CONFIG=./config-local.js node tools/dstarTest.js ...

	Live feeds:   node tools/dstarTest.js [--quadnet-only|--ircddb-only] [--connect-proxy http://host:port]
	Offline file: node tools/dstarTest.js --file <saved QuadNet ics log or ircDDB "N:record" lines>
	Offline page: node tools/dstarTest.js --dstarusers-file <saved dstarusers.org lastheard.php page>
	              (e.g. tools/fixtures/dstarusers-lastheard.html)

	Prints every spot the receiver would emit. With --file or --dstarusers-file, priming and
	max-age checks are disabled so that all events in the file are shown (subject to deduplication).
*/
const DstarReceiver = require('../dstar');
const fs = require('fs');
const readline = require('readline');

let args = process.argv.slice(2);
let options = {};
let file = null;
let dstarusersFile = null;

for (let i = 0; i < args.length; i++) {
	switch (args[i]) {
		case '--quadnet-only':
			options.ircddb = {disabled: true};
			break;
		case '--ircddb-only':
			options.quadnet = {disabled: true};
			break;
		case '--connect-proxy':
			options.ircddb = Object.assign({}, require('../config_loader').dstar.ircddb, {connectProxy: args[++i]});
			break;
		case '--file':
			file = args[++i];
			break;
		case '--dstarusers-file':
			dstarusersFile = args[++i];
			break;
		default:
			console.error(`Unknown argument: ${args[i]}`);
			process.exit(1);
	}
}

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
		console.log(`\n${stats.spots} spots: ${JSON.stringify(stats.byEvent)}`);
		process.exit(0);
	});
}
