const test = require('node:test');
const assert = require('node:assert/strict');
const {potaStateFromPark} = require('../hamutil');

test('uses a single US or Canadian state', () => {
	assert.equal(potaStateFromPark('US-NC'), 'US_NC');
	assert.equal(potaStateFromPark('CA-ON'), 'CA_ON');
	assert.equal(potaStateFromPark(' us-dc '), 'US_DC');
});

test('does not override when the park spans more than one state', () => {
	assert.equal(potaStateFromPark('US-NC,US-TN'), null);
	assert.equal(potaStateFromPark('US-CA,US-CO,US-ID,US-WY'), null);
	assert.equal(potaStateFromPark('CA-ON,CA-QC'), null);
	assert.equal(potaStateFromPark('US-NC,'), null);
});

test('ignores locations that are not a US or Canadian state', () => {
	assert.equal(potaStateFromPark('ES-AN'), null);
	assert.equal(potaStateFromPark('DE-NI'), null);
	assert.equal(potaStateFromPark('AR-B'), null);
	assert.equal(potaStateFromPark(''), null);
	assert.equal(potaStateFromPark(null), null);
});
