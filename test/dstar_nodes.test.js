// dstar_nodes.js requires config_loader too; make sure it can resolve without relying on the
// environment already having HAMALERT_CONFIG set.
process.env.HAMALERT_CONFIG = process.env.HAMALERT_CONFIG || 'config-local.js';

const test = require('node:test');
const assert = require('node:assert/strict');
const DstarNodeDirectory = require('../dstar_nodes');

// parseQuadnet()/parseIrcddb() don't read `this`, so call them via the prototype without ever
// constructing a DstarNodeDirectory - construction does a real network fetch and reads/writes a
// dump file (see the constructor and refresh()).
function parseQuadnet(html) { return DstarNodeDirectory.prototype.parseQuadnet.call(null, html); }
function parseIrcddb(html) { return DstarNodeDirectory.prototype.parseIrcddb.call(null, html); }

test('parseNodeField: underscore-padded call+module', () => {
	assert.deepEqual(DstarNodeDirectory.parseNodeField('2E0CMS_B'), {call: '2E0CMS', module: 'B'});
	assert.deepEqual(DstarNodeDirectory.parseNodeField('A62A___C'), {call: 'A62A', module: 'C'});
	assert.deepEqual(DstarNodeDirectory.parseNodeField('W4HFH__C'), {call: 'W4HFH', module: 'C'});
});

test('parseNodeField: rejects all-underscore and lowercase fields', () => {
	assert.equal(DstarNodeDirectory.parseNodeField('_______C'), null);
	assert.equal(DstarNodeDirectory.parseNodeField('w4hfh_c'), null);
});

test('parseNodeField: a field with no underscore separator still matches (documented lenience)', () => {
	// Everything but the trailing letter is read as the call, since the underscore run is
	// optional ("_*"). Callers only ever pass an exact 8-char field, captured by an outer
	// [A-Z0-9_]{8} regex (see parseQuadnet/parseIrcddb below), so this short, unpadded shape
	// never actually occurs in practice - it's not a validated "is this a real callsign" check.
	assert.deepEqual(DstarNodeDirectory.parseNodeField('W4HFH'), {call: 'W4HF', module: 'H'});
});

test('parseQuadnet: one row per <tr>, skips a row with a blank/zero frequency', () => {
	let html = `<tr><td><font size=1>2E0CMS_B</td><td><font size=1>145.500</td><td><font size=1>-0.600</td>
<tr><td><font size=1>A62A___C</td><td><font size=1></td><td><font size=1></td>`;
	assert.deepEqual(parseQuadnet(html), [
		['2E0CMS-B', {frequency: 145.5, offset: -0.6, source: 'quadnet'}]
	]);
});

test('parseIrcddb: repeater cell embedded in an ircddb-log link, QRG/offset in a bare <td>', () => {
	let html = `<tr bgcolor="#f0f0a0"><td><a href="/cgi-bin/ircddb-log?x=1&y=W4HFH__C">W4HFH  C</a></td><td>445.000<br>-5.000</td></tr>
<tr bgcolor="#f0f0f0"><td><a href="/cgi-bin/ircddb-log?x=1&y=ZZ9ZZZ__C">ZZ9ZZZ  C</a></td><td><br></td></tr>`;
	assert.deepEqual(parseIrcddb(html), [
		['W4HFH-C', {frequency: 445, offset: -5, source: 'ircddb'}]
	]);
});
