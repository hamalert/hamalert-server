// telnetconn.js loads config at import time.
process.env.HAMALERT_CONFIG = process.env.HAMALERT_CONFIG || 'config-local.js';

const test = require('node:test');
const assert = require('node:assert/strict');
const {PassThrough} = require('stream');
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
				findOne(query, callback) {
					callback(null, user);
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

test('telnet login rejects a missing or malformed password hash', async () => {
	for (const passwordField of [undefined, null, 123, 'x'.repeat(60), '$2x$' + 'a'.repeat(56)]) {
		const result = await attempt({username: 'N0CALL', password: passwordField, telnetPassword: 'cluster'}, 'anything');
		assert.equal(result.result, 'denied', `accepted login for password field ${passwordField}`);
		assert.notEqual(result.state, 'loggedin');
		assert.match(result.output, /Login failed/);
	}
});
