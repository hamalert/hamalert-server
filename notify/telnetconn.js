const config = require('../config');
const hamutil = require('../hamutil');
const net = require('net');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const EventEmitter = require('events');
const sprintf = require('sprintf-js').sprintf;

class TelnetConnection extends EventEmitter {
	constructor(socket, db) {
		super();
		this.socket = socket;
		this.db = db;
		this.rl = readline.createInterface(socket);
		this.state = 'login';
		this.clusterMode = 'classic';
		this.pendingLines = [];

		this.socket.setKeepAlive(true, 60000);
		
		this.socket.on('error', () => {
			this.socket.destroy();
			if (this.state == 'loggedin') {
				this.emit('logout', this.username);
				this.state = 'loggedout';
			}
		});

		this.socket.write("HamAlert Telnet/Cluster emulation server\r\n");
		this.socket.write("login: ");

		this.rl.on('line', line => {
			this.handleLine(line);
		})
		this.rl.on('error', e => {
			this.socket.destroy();
			if (this.state == 'loggedin') {
				this.emit('logout', this.username);
				this.state = 'loggedout';
			}
		})
		this.socket.on('close', () => {
			if (this.state == 'loggedin') {
				this.emit('logout', this.username);
				this.state = 'loggedout';
			}
		});
	}

	handleLine(line) {
		line = line.trim();
		if (line === "") {
			return;
		}

		switch (this.state) {
			case 'login':
				this.username = line.toUpperCase();
				this.socket.write('\r\n');
				this.socket.write("password: ");
				this.state = 'password';
				break;
			case 'password':
				if (!this.password) {
					this.password = line;
					this.socket.write('\r\n');
					this.doLogin();
				} else {
					this.pendingLines.push(line);
				}
				break;
			case 'loggedin':
				let matches = line.match(/^echo (.+)$/i);
				if (matches) {
					this.socket.write(matches[1] + '\r\n');
					break;
				}

				matches = line.match(/^set\/(ve7cc|json)$/i);
				if (matches) {
					this.clusterMode = matches[1];
					this.socket.write("Operation successful\r\n");
					break;
				}

				matches = line.match(/^sh(?:ow)?\/(?:my)?dx(?:[ /](.+))?$/i);
				if (matches) {
					this.db.collection('spots').find({user_id: this.user._id, receivedDate: {$gte: new Date(new Date().getTime() - 3600000)}, actions: 'telnet'}).sort({receivedDate: -1}).limit(parseInt(matches[1] ?? 20)).toArray()
						.then(spots => {
							if (spots.length == 0) {
								this.socket.write('No spots\r\n')
							} else {
								spots.sort((a, b) => {
									return a.receivedDate > b.receivedDate ? 1 : a.receivedDate < b.receivedDate ? -1 : 0;
								});
								spots.forEach(spot => {
									this.notify(spot);
								});
							}
						});
				}
		}
	}

	doLogin() {
		this.db.collection('users').findOne({username: this.username}, (err, user) => {
			if (err) {
				this.socket.write("Database error\r\n");
				this.socket.destroy();
				return;
			}

			if (!user) {
				this.socket.write("Login failed, check username and password\r\n");
				this.socket.destroy();
				return;
			}

			this.user = user;

			if (user.telnetPassword && this.password === user.telnetPassword) {
				this.finalizeLogin();
			} else {
				bcrypt.compare(this.password, user.password, (err, res) => {
					if (res === false) {
						this.socket.write("Login failed, check username and password\r\n");
						this.socket.destroy();
						return;
					}

					this.finalizeLogin();
				});
			}
		});
	}

	finalizeLogin() {
		this.socket.write("Hello " + this.username + ", this is HamAlert\r\n");
		this.socket.write(this.username + " de HamAlert >\r\n");
		this.state = 'loggedin';
		this.emit('login', this.username);

		for (let line of this.pendingLines) {
			this.handleLine(line);
		}
	}

	notify(spot, triggerComment) {
		let freq = sprintf("%.1f", spot.frequency*1000);
		let spotter = spot.spotter.substring(0, 16 - freq.length);
		let spotterFreq = spotter + ':' + ' '.repeat(17 - freq.length - spotter.length) + freq;
		let comment = spot.comment || '';
		if (spot.source !== 'cluster') {
			let commentElements = [];
			if (spot.source === 'pskreporter' && spot.modeDetail) {
				commentElements.push(spot.modeDetail.toUpperCase());
			}
			if (spot.snr !== undefined) {
				commentElements.push(`${spot.snr}dB`);
			}
			if (spot.speed !== undefined) {
				commentElements.push(`${spot.speed}wpm`);
			}
			if (spot.summitRef) {
				commentElements.push(spot.summitRef);
			}
			if (spot.wwffRef) {
				commentElements.push(spot.wwffRef);
			}
			if (spot.wwbotaRef) {
				commentElements.push(spot.wwbotaRef);
			}
			if (spot.iotaGroupRef) {
				commentElements.push(spot.iotaGroupRef);
			}
			if (this.clusterMode == 've7cc' && spot.comment) {
				commentElements.push(spot.comment);
			}

			comment = commentElements.join(' ');
		}

		let line;
		if (this.clusterMode == 've7cc') {
			let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
			line = sprintf("CC11^%s^%s^%02d-%s-%04d^%02d%02dZ^%s^%s^\r\n",
				freq, spot.fullCallsign,
				spot.receivedDate.getDate(), months[spot.receivedDate.getMonth()], spot.receivedDate.getFullYear(),
				spot.receivedDate.getHours(), spot.receivedDate.getMinutes(),
				comment, spot.spotter);
		} else if (this.clusterMode == 'json') {
			let params = hamutil.makeSpotParams(spot);
			params.triggerComment = triggerComment;
			line = JSON.stringify(params) + "\r\n";
		} else {
			line = sprintf("DX de %s  %-12s %-30s %sZ\r\n",
				spotterFreq, spot.fullCallsign.substring(0, 12), comment.substring(0, 30), spot.time.replace(':', ''));
		}
		
		this.socket.write(line);
	}
}

module.exports = TelnetConnection;
