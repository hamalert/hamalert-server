// Requiring dstar_groups.js needs a config (see config_loader.js); set one before requiring so
// the test runs without HAMALERT_CONFIG already set in the environment. Note: this only matters
// if something in this file constructs a DstarGroupDirectory instance - it does not, to avoid a
// real network fetch (see dstar_nodes.js's equivalent note in test/dstar.test.js); parseStarnetPage
// is exercised as a pure static function instead.
process.env.HAMALERT_CONFIG = process.env.HAMALERT_CONFIG || 'config-local.js';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DstarGroupDirectory = require('../dstar_groups');

const fixturesDir = path.join(__dirname, '..', 'tools', 'fixtures');
const readFixture = name => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

test('parseStarnetPage parses the "QuadNet Smart Groups" table, ignoring "Group Users"', () => {
	let groups = DstarGroupDirectory.parseStarnetPage(readFixture('quadnet-starnet.html'));

	// The fixture's first table ("Group Users") lists N4EDO under "DELINK" and "DSTAR1" talk
	// groups; those rows must never surface as parsed groups (wrong shape, wrong table)
	assert.ok(groups.length >= 3, `expected at least 3 groups, got ${groups.length}`);
	for (let group of groups) {
		assert.notEqual(group.subscribe, 'N4EDO');
	}

	let byCall = new Map(groups.map(g => [g.subscribe, g]));

	assert.deepEqual(byCall.get('DSTAR1'), {
		subscribe: 'DSTAR1',
		unsubscribe: 'DSTAR1 T',
		module: 'KN4RSC-A',
		name: 'QuadNet Array'
	});

	assert.deepEqual(byCall.get('QNET20 C'), {
		subscribe: 'QNET20 C',
		unsubscribe: 'QNET20 Z',
		module: 'KN4RSC-C',
		name: 'QuadNet Tech Chat'
	});

	assert.deepEqual(byCall.get('DELINK'), {
		subscribe: 'DELINK',
		unsubscribe: 'DELINK T',
		module: 'KN4RSC-D',
		name: 'Delaware Talk Group'
	});
});

test('parseStarnetPage: subscribe/unsubscribe keep internal spaces but trim trailing padding', () => {
	let groups = DstarGroupDirectory.parseStarnetPage(readFixture('quadnet-starnet.html'));
	let qnet20 = groups.find(g => g.subscribe === 'QNET20 C');
	assert.ok(qnet20, 'QNET20 C group not found');
	// "QNET20&nbsp;C" -> "QNET20 C": a real internal space, not collapsed or trimmed away
	assert.equal(qnet20.subscribe, 'QNET20 C');
	assert.equal(qnet20.unsubscribe, 'QNET20 Z');
});

test('parseStarnetPage returns [] for a page with no "QuadNet Smart Groups" table', () => {
	assert.deepEqual(DstarGroupDirectory.parseStarnetPage('<p>nothing here</p>'), []);
	assert.deepEqual(DstarGroupDirectory.parseStarnetPage(''), []);
});

test('parseStarnetPage is tolerant of a table with only the "Group Users" table present', () => {
	let html = `
		<p>Group Users:</p>
		<table><tr><td>Talk Group</td><td>User</td><td>Last Heard</td></tr>
		<tr><td>DSTAR1</td><td>N4EDO</td><td align="right">6 min</td></tr></table>
	`;
	assert.deepEqual(DstarGroupDirectory.parseStarnetPage(html), []);
});
