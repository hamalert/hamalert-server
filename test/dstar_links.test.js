// dstar_links.js doesn't actually require config_loader, but set this anyway for consistency
// with the other test files (and in case that ever changes).
process.env.HAMALERT_CONFIG = process.env.HAMALERT_CONFIG || 'config-local.js';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ReflectorLinkDirectory = require('../dstar_links');

const fixturesDir = path.join(__dirname, '..', 'tools', 'fixtures', 'reflectors');
const readFixture = name => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

test('parseClassicHtml: REF030, a plain "Module A".."Module E" table', () => {
	let map = ReflectorLinkDirectory.parseClassicHtml(readFixture('REF030-classic.html'));
	assert.equal(map.size, 41);
	assert.equal(map.get('GB7ME-B'), 'C');
	assert.equal(map.get('W9BCC-A'), 'C');
});

test('parseClassicHtml: REF032, an extra leading "#" row-number column', () => {
	let map = ReflectorLinkDirectory.parseClassicHtml(readFixture('REF032-classic.html'));
	assert.deepEqual(map, new Map([['NA9PL-B', 'A'], ['SR5UVR-B', 'A'], ['SR7UVL-B', 'A']]));
});

test('parseClassicHtml: REF029, an empty "Linked Gateways" table yields an empty Map, not an error', () => {
	let map = ReflectorLinkDirectory.parseClassicHtml(readFixture('REF029-empty.html'));
	assert.equal(map.size, 0);
});

test('parseJsonGateways: REF075 DREFD-style {gateways: [{callsign, module}]} payload', () => {
	let data = JSON.parse(readFixture('REF075-api.json'));
	let map = ReflectorLinkDirectory.parseJsonGateways(data);
	assert.deepEqual([...map], [['EA5RKD', 'B'], ['ED2ZAB', 'C'], ['ED4ZAD', 'B']]);
});

test('parseJsonGateways: malformed/missing gateways array yields an empty Map', () => {
	assert.equal(ReflectorLinkDirectory.parseJsonGateways({}).size, 0);
	assert.equal(ReflectorLinkDirectory.parseJsonGateways(null).size, 0);
});

test('findFramesetUrl: resolves a frame src against the page URL, null when there is no frameset', () => {
	let framesetHtml = '<html><frameset><frame src="status.html"></frameset></html>';
	assert.equal(ReflectorLinkDirectory.findFramesetUrl(framesetHtml, 'http://ref020.dstargateway.org/'), 'http://ref020.dstargateway.org/status.html');
	assert.equal(ReflectorLinkDirectory.findFramesetUrl('<html><body>no frameset here</body></html>', 'http://ref020.dstargateway.org/'), null);
});

test('REF020-status.html is already the frame target (not the frameset wrapper) and parses directly', () => {
	let html = readFixture('REF020-status.html');
	assert.equal(ReflectorLinkDirectory.findFramesetUrl(html, 'http://ref020.dstargateway.org/'), null);
	let map = ReflectorLinkDirectory.parseClassicHtml(html);
	assert.equal(map.size, 4);
	assert.equal(map.get('AA3E-A'), 'A');
});

test('linkedCellRegex: a populated "Linked Gateways" cell', () => {
	assert.equal(ReflectorLinkDirectory.linkedCellRegex.test('GB7ME  B'), true);
	assert.deepEqual(ReflectorLinkDirectory.linkedCellRegex.exec('GB7ME  B').slice(1), ['GB7ME', 'B']);
	assert.equal(ReflectorLinkDirectory.linkedCellRegex.test(''), false);
	assert.equal(ReflectorLinkDirectory.linkedCellRegex.test('GB7ME'), false, 'no module letter');
});

test('refReflectorRegex: only a bare "REFnnn" callsign', () => {
	assert.equal(ReflectorLinkDirectory.refReflectorRegex.test('REF030'), true);
	assert.equal(ReflectorLinkDirectory.refReflectorRegex.test('REF030-C'), false, 'no module letter allowed');
	assert.equal(ReflectorLinkDirectory.refReflectorRegex.test('XRF030'), false, 'REF only, not other reflector families');
	assert.equal(ReflectorLinkDirectory.refReflectorRegex.test('ref030'), false, 'uppercase only');
});
