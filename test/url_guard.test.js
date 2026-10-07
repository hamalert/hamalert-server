const test = require('node:test');
const assert = require('node:assert/strict');
const {isDisallowedAddress, guardedLookup} = require('../notify/url_guard');

function lookup(hostname, options = {}) {
	return new Promise((resolve, reject) => {
		guardedLookup(hostname, options, (err, address, family) => {
			if (err)
				reject(err);
			else
				resolve(options.all ? address : {address, family});
		});
	});
}

test('blocks loopback, private, link-local and non-global ranges', () => {
	const blocked = [
		'127.0.0.1',
		'127.0.0.2',
		'0.0.0.0',
		'10.1.2.3',
		'100.64.1.1',
		'169.254.169.254',
		'172.16.5.1',
		'192.168.1.1',
		'192.0.2.1',
		'198.18.0.1',
		'198.51.100.1',
		'203.0.113.1',
		'224.0.0.1',
		'240.0.0.1',
		'255.255.255.255',
		'::1',
		'::',
		'fc00::1',
		'fd00::1',
		'fe80::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:10.0.0.1',
		'::ffff:169.254.169.254',
		'64:ff9b::7f00:1',
		'64:ff9b::127.0.0.1',
		'64:ff9b:1::1',
	];
	for (const address of blocked)
		assert.equal(isDisallowedAddress(address), true, address);
});

test('allows ordinary public addresses', () => {
	const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2001:4860:4860::8888', '64:ff9b::808:808'];
	for (const address of allowed)
		assert.equal(isDisallowedAddress(address), false, address);
});

test('guardedLookup refuses non-public targets and keeps a public address', async () => {
	await assert.rejects(lookup('127.0.0.1'), {code: 'EBLOCKED'});
	await assert.rejects(lookup('::1'), {code: 'EBLOCKED'});
	await assert.rejects(lookup('localhost'), {code: 'EBLOCKED'});
	await assert.rejects(lookup('foo.localhost'), {code: 'EBLOCKED'});

	const dns = require('dns');
	const original = dns.lookup;
	try {
		dns.lookup = (hostname, options, callback) => {
			callback(null, [{address: '127.0.0.1', family: 4}]);
		};
		await assert.rejects(lookup('evil.attacker.com'), {code: 'EBLOCKED'});

		dns.lookup = (hostname, options, callback) => {
			callback(null, [
				{address: '127.0.0.1', family: 4},
				{address: '93.184.216.34', family: 4},
			]);
		};
		const result = await lookup('evil.attacker.com', {all: true});
		assert.deepEqual(result, [{address: '93.184.216.34', family: 4}]);
	} finally {
		dns.lookup = original;
	}
});
