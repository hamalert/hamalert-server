process.env.HAMALERT_CONFIG = process.env.HAMALERT_CONFIG || 'config-local.js';

const test = require('node:test');
const assert = require('node:assert/strict');
const {staleSources, formatReport} = require('../tools/spotWatchdog');

const now = new Date('2026-10-26T08:00:00Z');
const sources = [
	{source: 'cluster', interval: 15 * 60 * 1000},
	{source: 'rbn', interval: 5 * 60 * 1000},
	{source: 'pskreporter', interval: 30 * 60 * 1000}
];

test('each source is checked against its own interval', () => {
	let lastSeen = {
		cluster: new Date(now.getTime() - 14 * 60 * 1000),
		rbn: new Date(now.getTime() - 6 * 60 * 1000),
		pskreporter: new Date(now.getTime() - 20 * 60 * 1000)
	};
	assert.deepEqual(staleSources(lastSeen, now, sources).map((entry) => entry.source), ['rbn']);
});

test('a missing source or one exactly at its interval is stale', () => {
	assert.deepEqual(staleSources(null, now, sources).map((entry) => entry.source), ['cluster', 'rbn', 'pskreporter']);
	let lastSeen = {
		cluster: new Date(now.getTime() - sources[0].interval),
		rbn: new Date(now.getTime() - sources[1].interval + 1),
		sotawatch: now
	};
	assert.deepEqual(staleSources(lastSeen, now, sources).map((entry) => entry.source), ['cluster', 'pskreporter']);
});

test('report lists every monitored source with its interval', () => {
	let lastSeen = {cluster: new Date(now.getTime() - 80 * 60 * 1000)};
	let report = formatReport(lastSeen, now, sources);
	assert.equal(report, [
		'cluster: 2026-10-26T06:40:00.000Z (80 min ago, interval 15 min)',
		'rbn: never (interval 5 min)',
		'pskreporter: never (interval 30 min)'
	].join('\n'));
});
