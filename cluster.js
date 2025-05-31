const reconnect = require('reconnect-net');
const carrier = require('carrier');
const hamutil = require('./hamutil');
const EventEmitter = require('events');
const axios = require('axios');
const moment = require('moment');

// Summit ref regex from http://www.adif.org/304/adx304.xsd
var summitRefRegex = /([a-zA-Z0-9]{1,8}\/[a-zA-Z]{2})\-?((?:[0-9][0-9][1-9])|(?:[0-9][1-9][0])|(?:[1-9][0-9][0]))/;

class ClusterReceiver extends EventEmitter {
	constructor(config) {
		super();
		this.config = config;
		this.currentServerIndex = 0;
	}
	
	start() {
		this.restartConnection();
	}
	
	restartConnection() {
		if (this.re) {
			this.re.disconnect();
		}
		
		this.resetTimer();
		let server = this.config.servers[this.currentServerIndex];
		this.currentServerIndex++;
		if (this.currentServerIndex >= this.config.servers.length) {
			this.currentServerIndex = 0;
		}
		this.re = reconnect((stream) => {
			console.log(`Connected to Cluster ${this.config.source} (${server.host}:${server.port})`);
			if (this.config.login) {
				stream.write(this.config.login + "\n");
			}
			
			carrier.carry(stream, (line) => {
				this.handleLine(line);
			}, 'latin1');
			// We're using latin1 here because utf8 causes field widths to shift in the presence of non-ASCII characters
		})
		
		this.re.on('error', (err) => {
			console.error(`Cluster ${this.config.source} connection error: ${err}`);
		});
		
		this.re.connect(server);
	}
	
	resetTimer() {
		if (this.timeout) {
			clearTimeout(this.timeout);
		}
		
		this.timeout = setTimeout(() => {
			console.error(`Cluster ${this.config.source}: timeout, reconnecting`);
			this.restartConnection();
		}, this.config.timeout);
	}
	
	handleLine(line) {
		this.resetTimer();
		if (/^DX de /.test(line)) {
			// Cluster format: fixed length fields
			let deFreq = line.substring(6, 26);
			deFreq = deFreq.split(':');
			if (deFreq.length != 2)
				return;
			
			let spot = {
				source: this.config.source,
				time: line.substring(70, 72) + ':' + line.substring(72, 74),
				fullCallsign: line.substring(26, 39).trim(),
				spotter: deFreq[0].trim(),
				frequency: (deFreq[1].trim())/1000,
				comment: line.substring(39, 70).trim(),
				rawText: line.replace(/\u0007/g, '')
			};
			spot.title = `${this.config.titlePrefix} ${spot.fullCallsign} (${hamutil.formatFrequency(spot.frequency)})`;
			
			// Check if we should extract specific fields from the comment field on special-purpose clusters
			if (this.config.modeSnr) {
				spot.mode = line.substring(39, 52).trim();
				spot.snr = line.substring(53, 69).trim();
				delete spot.comment;
			} else if (this.config.wwffMode) {
				let fields = spot.comment.split(' ');
				if (fields.length >= 2) {
					spot.wwffRefRaw = fields[0];
					spot.mode = fields[1];
					spot.comment = Buffer.from(fields.slice(2).join(' '), 'latin1').toString('utf8');
					spot.title = `${this.config.titlePrefix} ${spot.fullCallsign} in ${spot.wwffRefRaw} (${hamutil.formatFrequency(spot.frequency)} ${spot.mode})`;
				}
			}
			
			// Check filter
			if (spot.comment && this.config.filterRegex && this.config.filterRegex.test(spot.comment)) {
				console.info(`Cluster spot matches filter regex: ${spot.rawText}`);
				return;
			}

			if (spot.spotter && this.config.spotterFilterRegex && this.config.spotterFilterRegex.test(spot.spotter)) {
				console.info(`Cluster spot matches spotter filter regex: ${spot.spotter}`);
				return;
			}
			
			this.emit("spot", spot);
		} else if (/^WCY de DK0WCY.*? : (.+)$/.test(line)) {
			// Solar data: parse fields
			let matches = /^WCY de DK0WCY.*? : (.+)$/.exec(line);
			let fieldStrs = matches[1].split(' ')
			let fields = {}
			for (let fieldStr of fieldStrs) {
				let [k, v] = fieldStr.split('=')
				fields[k] = v
			}

			if (this.config.solardataTargetUrlBase) {
				let now = new Date()
				let url = this.config.solardataTargetUrlBase + '/' + moment().utc().format('YYYY-MM-DD/H')
				axios.post(url, {
					apiKey: this.config.solardataApiKey,
					sfi: parseInt(fields.SFI),
					a: parseInt(fields.A),
					k: parseInt(fields.K),
					expK: parseInt(fields.expK),
					r: parseInt(fields.R),
					sa: fields.SA,
					gmf: fields.GMF,
					aurora: (fields.Au == 'yes')
				})
			}
		} else {
			console.log("No match: " + line);
		}
	}
}

module.exports = ClusterReceiver;
