/*
	Standalone test for the D-STAR node/reflector frequency directory (no database needed).

	Fetches the QuadNet and ircDDB repeater lists and prints the lookup result for each node
	given on the command line.

	Usage: node tools/dstarNodeTest.js <node> [<node> ...]
	e.g.:  node tools/dstarNodeTest.js 2E0CMS-B W4HFH-C ZZ9ZZZ-C
*/
const DstarNodeDirectory = require('../dstar_nodes');

let nodes = process.argv.slice(2);
if (nodes.length === 0) {
	console.error('Usage: node tools/dstarNodeTest.js <node> [<node> ...]');
	process.exit(1);
}

console.log('Fetching D-STAR node directory (QuadNet + ircDDB)...');
let directory = new DstarNodeDirectory();

// The constructor already kicked off an initial refresh(); wait for a fresh one of our own
// (refresh() resolves once the attempt is done, whether it succeeded or failed - failures are
// handled internally and just leave the previous map, or an empty one on a first run, in place)
directory.refresh().then(() => {
	console.log(`(${directory.map.size} nodes total)`);
	for (let node of nodes) {
		let entry = directory.lookup(node.toUpperCase());
		if (entry) {
			console.log(`${node}: ${entry.frequency} MHz (offset ${entry.offset}, source: ${entry.source})`);
		} else {
			console.log(`${node}: not found`);
		}
	}
	process.exit(0);
});
