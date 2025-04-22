const config = require('../config');
const net = require('net');
const Notifier = require('./notifier');
const TelnetConnection = require('./telnetconn');

class TelnetNotifier extends Notifier {
	constructor(db) {
		super();
		this.db = db;
		this.clientMap = new Map();

		this.server = net.createServer(socket => {
			let connection = new TelnetConnection(socket, this.db);
			connection.on('login', (username) => {
				let connections = this.clientMap.get(username);
				if (!connections) {
					connections = [];
					this.clientMap.set(username, connections);
				}
				connections.push(connection);
			});
			connection.on('logout', (username) => {
				let connections = this.clientMap.get(username);
				if (connections) {
					let connectionIndex = connections.indexOf(connection);
					if (connectionIndex !== -1) {
						connections.splice(connectionIndex, 1);
					}
					if (connections.length == 0) {
						this.clientMap.delete(username);
					}
				}
			});
		});
		this.server.on('error', (e) => {
			console.error('Telnet server error: ' + e);
		});

		this.server.listen(config.telnetsrv.port);
	}

	notify(user, spot, comment) {
		let connections = this.clientMap.get(user.username);
		if (!connections) {
			return;
		}

		connections.forEach(connection => {
			try {
				connection.notify(spot, comment);
			} catch (e) {}
		});
	}
}

module.exports = TelnetNotifier;
