// telnetconn.js loads config at import time.
process.env.HAMALERT_CONFIG = process.env.HAMALERT_CONFIG || 'config-local.js';

const test = require('node:test');
const assert = require('node:assert/strict');
const {PassThrough} = require('stream');
const {mock} = require('node:test');
const bcrypt = require('bcryptjs');
const TelnetConnection = require('../notify/telnetconn');

const passwordHash = bcrypt.hashSync('secret', 4);

function fakeSocket() {
	const socket = new PassThrough();
	socket.setKeepAlive = () => {};
	socket.destroyed = false;
	const chunks = [];
	const write = socket.write.bind(socket);
	socket.write = (data) => {
		chunks.push(String(data));
		return write(data);
	};
	socket.output = () => chunks.join('');
	socket.destroy = () => {
		socket.destroyed = true;
		socket.emit('close');
	};
	return socket;
}

function fakeDb(user) {
	return {
		collection() {
			return {
				findOne() {
					return Promise.resolve(user);
				}
			}
		}
	};
}

function attempt(user, password) {
	const socket = fakeSocket();
	const conn = new TelnetConnection(socket, fakeDb(user));
	conn.username = 'N0CALL';
	conn.password = password;
	const origError = console.error;
	console.error = () => {};
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result) => {
			if (settled)
				return;
			settled = true;
			console.error = origError;
			resolve({result, output: socket.output(), state: conn.state});
		};
		conn.once('login', () => finish('login'));
		const destroy = socket.destroy;
		socket.destroy = () => {
			destroy();
			finish('denied');
		};
		conn.doLogin();
	});
}

test('telnet login accepts the account password and the telnet password', async () => {
	const user = {username: 'N0CALL', password: passwordHash, telnetPassword: 'cluster'};
	const account = await attempt(user, 'secret');
	assert.equal(account.result, 'login');
	assert.equal(account.state, 'loggedin');

	const telnet = await attempt(user, 'cluster');
	assert.equal(telnet.result, 'login');
	assert.equal(telnet.state, 'loggedin');
});

test('telnet login rejects a wrong password', async () => {
	const user = {username: 'N0CALL', password: passwordHash};
	const result = await attempt(user, 'nope');
	assert.equal(result.result, 'denied');
	assert.equal(result.state, 'password');
	assert.match(result.output, /Login failed/);
});

test('resends the cluster prompt as a keepalive when idle', () => {
	const config = require('../config_loader');
	mock.timers.enable({apis: ['setTimeout']});
	try {
		config.telnetsrv.keepAliveInterval = 60000;
		const socket = fakeSocket();
		const conn = new TelnetConnection(socket, fakeDb({username: 'N0CALL', telnetPassword: 'cluster'}));
		conn.state = 'loggedin';
		conn.username = 'N0CALL';
		conn.resetKeepAlive();

		mock.timers.tick(60000);
		const full = socket.output().match(/N0CALL de HamAlert .*\r\n/)[0];
		// DXSpider-style prompt: CALL de NODE dd-mm-yyyy hhmm>
		assert.match(full, /^N0CALL de HamAlert \d{2}-\d{2}-\d{4} \d{4}>\r\n$/);

		// After a keepalive, another minute of idleness sends another one
		mock.timers.tick(60000);
		assert.equal((socket.output().match(/de HamAlert \d{2}-\d{2}-\d{4}/g) || []).length, 2);

		// Sending a spot resets the idle period: no keepalive while spots flow
		const spot = {frequency: 14.074, spotter: 'N0CALL', fullCallsign: 'DL1ABC', comment: 'CQ', time: '12:34', source: 'cluster', receivedDate: new Date()};
		for (let i = 0; i < 5; i++) {
			conn.notify(spot);
			mock.timers.tick(40000); // less than a minute between spots
			assert.equal((socket.output().match(/de HamAlert \d{2}-\d{2}-\d{4}/g) || []).length, 2, `keepalive sent while spots were flowing (iteration ${i})`);
		}
		// Once the line goes quiet again, the keepalive resumes
		mock.timers.tick(60000);
		assert.equal((socket.output().match(/de HamAlert \d{2}-\d{2}-\d{4}/g) || []).length, 3);

		// While not logged in, no keepalive is sent
		const sock2 = fakeSocket();
		const conn2 = new TelnetConnection(sock2, fakeDb({username: 'N0CALL'}));
		mock.timers.tick(60000);
		assert.doesNotMatch(sock2.output(), /de HamAlert \d{2}-\d{2}-\d{4}/);
		conn2.state = 'loggedin';
		conn2.resetKeepAlive();
		mock.timers.tick(60000);
		assert.match(sock2.output(), /de HamAlert \d{2}-\d{2}-\d{4}/);
	} finally {
		delete config.telnetsrv.keepAliveInterval;
		mock.timers.reset();
	}
});

test('keepalive interval is taken from config.telnetsrv.keepAliveInterval', () => {
	const config = require('../config_loader');
	mock.timers.enable({apis: ['setTimeout']});
	try {
		// A configured interval is honoured
		config.telnetsrv.keepAliveInterval = 10000;
		const socket = fakeSocket();
		const conn = new TelnetConnection(socket, fakeDb({username: 'N0CALL', telnetPassword: 'cluster'}));
		conn.state = 'loggedin';
		conn.username = 'N0CALL';
		conn.resetKeepAlive();

		mock.timers.tick(9999);
		assert.doesNotMatch(socket.output(), /de HamAlert \d{2}-\d{2}-\d{4}/);
		mock.timers.tick(1);
		assert.match(socket.output(), /de HamAlert \d{2}-\d{2}-\d{4}/);

		// An interval of 0 disables the keepalive
		config.telnetsrv.keepAliveInterval = 0;
		const sock2 = fakeSocket();
		const conn2 = new TelnetConnection(sock2, fakeDb({username: 'N0CALL', telnetPassword: 'cluster'}));
		conn2.state = 'loggedin';
		conn2.username = 'N0CALL';
		conn2.resetKeepAlive();
		mock.timers.tick(10 * 60000);
		assert.doesNotMatch(sock2.output(), /de HamAlert \d{2}-\d{2}-\d{4}/);

		// No interval configured at all also disables the keepalive (no hidden default)
		delete config.telnetsrv.keepAliveInterval;
		const sock3 = fakeSocket();
		const conn3 = new TelnetConnection(sock3, fakeDb({username: 'N0CALL', telnetPassword: 'cluster'}));
		conn3.state = 'loggedin';
		conn3.username = 'N0CALL';
		conn3.resetKeepAlive();
		mock.timers.tick(10 * 60000);
		assert.doesNotMatch(sock3.output(), /de HamAlert \d{2}-\d{2}-\d{4}/);
	} finally {
		delete config.telnetsrv.keepAliveInterval;
		mock.timers.reset();
	}
});

test('telnet login rejects a missing or malformed password hash', async () => {
	for (const passwordField of [undefined, null, 123, 'x'.repeat(60), '$2x$' + 'a'.repeat(56)]) {
		const result = await attempt({username: 'N0CALL', password: passwordField, telnetPassword: 'cluster'}, 'anything');
		assert.equal(result.result, 'denied', `accepted login for password field ${passwordField}`);
		assert.notEqual(result.state, 'loggedin');
		assert.match(result.output, /Login failed/);
	}
});
