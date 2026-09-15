// Requiring dstar.js needs a config (see config_loader.js); set one before requiring so the
// test runs without HAMALERT_CONFIG already set in the environment.
process.env.HAMALERT_CONFIG = process.env.HAMALERT_CONFIG || 'config-local.js';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DstarReceiver = require('../dstar');

const fixturesDir = path.join(__dirname, '..', 'tools', 'fixtures');
const readFixture = name => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

// DstarReceiver.prototype.classify() only reads this.options, so it can be exercised without
// constructing a real DstarReceiver - construction would call getNodeDirectory(), which does a
// real network fetch (see dstar_nodes.js).
function classify(record) {
	let fakeReceiver = {options: {minVoiceDuration: 2, minVoiceDurationLinkCommand: 5, ignoreDirectedCalls: true}};
	return DstarReceiver.prototype.classify.call(fakeReceiver, record);
}

test('callsignRegex accepts a wide variety of real callsign shapes', () => {
	let valid = ['W1AW', 'K4ABC', 'N4EDO', 'AA1A', '2E0CMS', 'M0ABC', 'G4SPF', 'GB7ME', 'VK2ABC',
		'JA1ABC', 'HB9DQM', 'DL1ABC', '9A1A', '4X4XYZ', '3DA0RS', 'PY2ABC', 'VE3ABC', 'ZL1ABC',
		'ON4ERM', 'SP5ABC', 'VU2ABC', '7L1CAK', 'KO4WAU', 'M7IIA'];
	for (let call of valid) {
		assert.equal(DstarReceiver.callsignRegex.test(call), true, call);
	}
});

test('callsignRegex rejects blank, masked, slashed and lowercase forms', () => {
	assert.equal(DstarReceiver.callsignRegex.test(''), false);
	assert.equal(DstarReceiver.callsignRegex.test('********'), false);
	assert.equal(DstarReceiver.callsignRegex.test('N0CALL/P'), false, 'slash forms are never matched here');
	assert.equal(DstarReceiver.callsignRegex.test('n0call'), false);
	assert.equal(DstarReceiver.callsignRegex.test('ABCDEFGHI'), false, 'longer than any real prefix+digit+suffix shape');
	// CQCQCQ has no digit at all, so it never matches; classify() special-cases it separately
	// (ur.startsWith('CQCQCQ')) instead of relying on this regex.
	assert.equal(DstarReceiver.callsignRegex.test('CQCQCQ'), false);
	// REF030 happens to have the same shape as a real callsign (letters, then a digit, then more
	// digits) and DOES match: this regex only validates callsign SHAPE, not whether something
	// actually names a reflector - that's dstarusersReflectorPrefixRegex's job.
	assert.equal(DstarReceiver.callsignRegex.test('REF030'), true);
});

test('linkCommandRegex matches 8-char UR link commands, with 0-3 spaces of padding', () => {
	for (let ur of ['REF030CL', 'XRF002AL', 'DCS001BL', 'XLX307DL', 'REF30 CL']) {
		assert.equal(DstarReceiver.linkCommandRegex.test(ur), true, ur);
	}
});

test('linkCommandRegex rejects non-link URs', () => {
	for (let ur of ['CQCQCQ  ', 'REF030CU', '       I', '       E', 'W4HFH  C']) {
		assert.equal(DstarReceiver.linkCommandRegex.test(ur), false, ur);
	}
});

test('quadnetLineRegex/parseQuadnetLine parses every line of the quadnet-ics fixture', () => {
	let lines = readFixture('quadnet-ics.txt').split('\n').filter(Boolean);
	assert.equal(lines.length, 40);
	for (let line of lines) {
		let record = DstarReceiver.parseQuadnetLine(line);
		assert.ok(record, line);
		assert.equal(record.feed, 'quadnet');
		assert.ok(record.time instanceof Date && !isNaN(record.time));
		assert.equal(typeof record.my, 'string');
		assert.equal(typeof record.ur, 'string');
		assert.equal(typeof record.rpt1, 'string');
		assert.equal(typeof record.rpt2, 'string');
		assert.equal(typeof record.duration, 'number');
	}
});

test('parseQuadnetLine: one CQCQCQ line, field by field', () => {
	let line = '2026-09-15 11:13:56    7.64s:  0%: 0.0% K4TRM___/7100 CQCQCQ__ K4TRM__C K4TRM__G Patterson_Springs_NC ________';
	assert.deepEqual(DstarReceiver.parseQuadnetLine(line), {
		feed: 'quadnet',
		time: new Date('2026-09-15T11:13:56Z'),
		duration: 7.64,
		silence: 0,
		ber: 0,
		my: 'K4TRM',
		ext: '7100',
		ur: 'CQCQCQ  ',
		rpt1: 'K4TRM  C',
		rpt2: 'K4TRM  G',
		msg: 'Patterson Springs NC',
		dest: '        ',
		stats: true
	});
});

test('ircddbLineRegex/parseIrcddbLine parses every line of the ircddb-jj3 fixture, header and stats', () => {
	let lines = readFixture('ircddb-jj3.txt').split('\n').filter(Boolean);
	assert.equal(lines.length, 36);
	let headers = 0, stats = 0;
	for (let line of lines) {
		let record = DstarReceiver.parseIrcddbLine(line);
		assert.ok(record, line);
		assert.equal(record.feed, 'ircddb');
		assert.ok(record.time instanceof Date && !isNaN(record.time));
		record.stats ? stats++ : headers++;
	}
	assert.equal(headers, 18);
	assert.equal(stats, 18);
});

test('ircddbStatsRegex/parseIrcddbLine: stats line carries duration/silence/ber; header line carries msg', () => {
	let statsLine = '1744:20260915115738********OZ9REZ_B1OZ9REZ_GDCS004ML000000____00________0.3s_S:0%_E:0.0%____';
	let stats = DstarReceiver.parseIrcddbLine(statsLine);
	assert.equal(stats.stats, true);
	assert.equal(stats.duration, 0.3);
	assert.equal(stats.silence, 0);
	assert.equal(stats.ber, 0);
	assert.equal(stats.msg, '');

	let headerLine = '1773:20260915120123DD3SI___DB0DF__B0DB0DF__GCQCQCQ__000000____00DCS001_FSiggi_Siemensstadt__';
	let header = DstarReceiver.parseIrcddbLine(headerLine);
	assert.equal(header.stats, false);
	assert.equal(header.my, 'DD3SI');
	assert.equal(header.msg, 'Siggi Siemensstadt');
});

test('classify: CQCQCQ is active voice on the repeater module', () => {
	let record = {feed: 'quadnet', my: 'K4TRM', ur: 'CQCQCQ  ', rpt1: 'K4TRM  C', rpt2: 'K4TRM  G', dest: '        ', duration: 7.64};
	assert.deepEqual(classify(record), [{type: 'active', node: 'K4TRM-C', reflector: null}]);
});

test('classify: a link command held long enough produces linked + active', () => {
	let record = {feed: 'quadnet', my: 'HS1HMY', ur: 'XLX822ZL', rpt1: 'HS1HMY C', rpt2: 'HS1HMY G', dest: '        ', duration: 8.22};
	assert.deepEqual(classify(record), [
		{type: 'linked', node: 'HS1HMY-C', reflector: 'XLX822-Z'},
		{type: 'active', node: 'HS1HMY-C', reflector: 'XLX822-Z'}
	]);
});

test('classify: info/unlink/echo control commands never produce events', () => {
	assert.deepEqual(classify({feed: 'quadnet', my: 'KI4LAX', ur: '       I', rpt1: 'KI4LAX B', rpt2: 'KI4LAX G', dest: '        ', duration: 0.44}), []);
	assert.deepEqual(classify({feed: 'quadnet', my: 'SP5PA', ur: '       U', rpt1: 'SP5PA  B', rpt2: 'SP5PA  G', dest: '        ', duration: 1.04}), []);
	assert.deepEqual(classify({feed: 'quadnet', my: 'SP5PA', ur: '       E', rpt1: 'SP5PA  B', rpt2: 'SP5PA  G', dest: '        ', duration: 2.74}), []);
});

test('classify: dstarusers.org rows pass their own pre-built events straight through', () => {
	let record = {feed: 'dstarusers', events: [{type: 'active', reflector: 'REF030-C'}]};
	assert.deepEqual(classify(record), record.events);
});

test('parseDstarusersPage parses the fixture into newest-first records', () => {
	let records = DstarReceiver.parseDstarusersPage(readFixture('dstarusers-lastheard.html'));
	assert.equal(records.length, 80);
	for (let i = 1; i < records.length; i++) {
		assert.ok(records[i - 1].time >= records[i].time, 'rows must stay in newest-first order');
	}
});

test('parseDstarusersPage: known row, field by field', () => {
	let records = DstarReceiver.parseDstarusersPage(readFixture('dstarusers-lastheard.html'));
	let first = records[0];
	assert.equal(first.my, 'W4JEA');
	assert.equal(first.time.toISOString(), '2026-09-12T12:42:49.000Z');
	assert.equal(first.nodeKey, 'WA4TCD-C');
	assert.equal(first.msg, 'Vero Beach, Fl, USA');
	assert.deepEqual(first.events, [{type: 'active', node: 'WA4TCD-C', reflector: undefined}]);
});

test('parseDstarusersNode', () => {
	assert.deepEqual(DstarReceiver.parseDstarusersNode('REF030 C 2 Meters'), {id: 'REF030-C', isReflector: true, band: undefined});
	assert.deepEqual(DstarReceiver.parseDstarusersNode('NS9RC B 440 MHz'), {id: 'NS9RC-B', isReflector: false, band: '70cm'});
	assert.equal(DstarReceiver.parseDstarusersNode('REF030 Dongle User'), null, 'a module-less report is a dongle/hotspot login, not a transmission');
	assert.deepEqual(DstarReceiver.parseDstarusersNode('W4HFH C  2 Meters'), {id: 'W4HFH-C', isReflector: false, band: '2m'});
	assert.deepEqual(DstarReceiver.parseDstarusersNode('XLX307 D 1.2GHz'), {id: 'XLX307-D', isReflector: true, band: undefined});
});

test('dstarusersTimeRegex', () => {
	assert.equal(DstarReceiver.dstarusersTimeRegex.test('09/12/26 12:42:49 UTC'), true);
	assert.equal(DstarReceiver.dstarusersTimeRegex.test('09/12/26 12:42:49'), false, 'missing " UTC" suffix');
});

test('cleanCell/htmlUnescape strip tags, unescape entities, and collapse whitespace', () => {
	assert.equal(DstarReceiver.cleanCell('<a href="x"><b>W4HFH</b></a>&nbsp;&nbsp;C'), 'W4HFH C');
	assert.equal(DstarReceiver.htmlUnescape('&nbsp;&amp;&lt;&gt;&quot;&#39;'), ' &<>"\'');
});

test('formatNode', () => {
	assert.equal(DstarReceiver.formatNode('W4HFH  C'), 'W4HFH-C');
	assert.equal(DstarReceiver.formatNode('REF048 B'), 'REF048-B');
	assert.equal(DstarReceiver.formatNode('        '), null);
	assert.equal(DstarReceiver.formatNode('W4HFH   '), 'W4HFH');
});
