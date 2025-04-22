const config = require('./config');
const reconnect = require('reconnect-net');
const carrier = require('carrier');
const hamutil = require('./hamutil');
const TTLCache = require('@isaacs/ttlcache');
const EventEmitter = require('events');

const rbnSpotRegex = /^DX de (\S+):\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+dB\s+(?:(\S+)\s+WPM)?.*(?:CQ|DX)\s+(\d+)Z$/;

class RbnReceiver extends EventEmitter {
	constructor(iconfig) {
		super();
		this.config = iconfig;
		if (this.config.quorum) {
			this.spotCache = new TTLCache({ttl: this.config.quorumInterval});
		}
	}

	start() {
		this.restartConnection();
	}
	
	restartConnection() {
		if (this.re)
			this.re.disconnect();

		this.resetTimer();
		this.re = reconnect((stream) => {
			console.log("Connected to RBN");
			stream.write(this.config.login + "\r\n");
			if (this.config.server.commands) {
				this.config.server.commands.forEach(command => {
					stream.write(command + "\r\n");
				});
			}
			
			carrier.carry(stream, (line) => {
				this.handleLine(line);
			});
		});
		
		this.re.on('error', (err) => {
			console.error(`RBN connection error: ${err}`);
		});
		
		this.re.connect(this.config.server);
	}
	
	resetTimer() {
		if (this.timeout) {
			clearTimeout(this.timeout);
		}
		
		this.timeout = setTimeout(() => {
			console.error("RBN: timeout, reconnecting");
			this.restartConnection();
		}, this.config.timeout);
	}
	
	handleLine(line) {
		this.resetTimer();
		let matches = rbnSpotRegex.exec(line);
		if (matches) {
			var spot = {
				source: 'rbn',
				time: matches[7].substring(0, 2) + ':' + matches[7].substring(2, 4),
				fullCallsign: matches[3],
				spotter: matches[1].replace("-#", ""),
				frequency: (matches[2]/1000).toFixed(4),
				mode: matches[4],
				snr: parseInt(matches[5]),
				rawText: line
			};
			if (matches[6]) {
				spot.speed = parseInt(matches[6]);
			}
			spot.title = `RBN spot ${spot.fullCallsign} (${hamutil.formatFrequency(spot.frequency)} ${spot.mode})`;
			
			// Detect bogus callsigns - 8 characters or longer, with more than one run of digits and no suffix
			if (spot.fullCallsign.length >= 8 && spot.fullCallsign.match(/[0-9]+[A-Z]+[0-9]+/) && !spot.fullCallsign.match(/\//)) {
				console.log(`Dropping bogus callsign ${spot.fullCallsign} from RBN`);
				return;
			}

			this.checkQuorumAndEmit(spot);
		} else {
			console.log("No match: " + line);
		}
	}

	checkQuorumAndEmit(spot) {
		if (!this.config.quorum) {
			this.emit("spot", spot);
			return;
		}

		let band = config.bands.find((element) => {
			return (element.from <= spot.frequency && element.to >= spot.frequency)
		});
		if (band === undefined) {
			console.log(`RBN: unknown band for frequency ${spot.frequency}`);
			return;
		}
		
		let key = `${spot.fullCallsign}-${band.band}-${spot.mode}`;
		let cachedSpots = this.spotCache.get(key);
		if (cachedSpots === undefined) {
			cachedSpots = [];
		}
		
		// Add spot to cache entry
		cachedSpots.push(spot);

		// Filter out expired spots
		let now = new Date();
		cachedSpots = cachedSpots.filter(cachedSpot => (now - cachedSpot.date) < this.config.quorumInterval);

		// Count number of unique spotters
		let uniqueSpotterCount = cachedSpots.reduce((resultSet, item) => resultSet.add(item.spotter), new Set).size;
		
		if (uniqueSpotterCount >= this.config.quorum) {
			// Quorum met; emit any held back spots
			let minifiedSpots = [];
			for (let cachedSpot of cachedSpots) {
				if (cachedSpot.emitted) {
					minifiedSpots.push(cachedSpot);
					continue;
				}
				
				if ((now - cachedSpot.date) < this.config.maxAge) {
					this.emit("spot", cachedSpot);

					// Only retain minimal data about emitted spots (to save memory)
					minifiedSpots.push({
						emitted: true,
						date: cachedSpot.date,
						spotter: cachedSpot.spotter
					});
				}
			}
			cachedSpots = minifiedSpots;
		}
		
		// Save to cache (updates recently used date)
		this.spotCache.set(key, cachedSpots);
	}
}

module.exports = RbnReceiver;
