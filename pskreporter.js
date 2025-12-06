const config = require('./config');
const hamutil = require('./hamutil');
const EventEmitter = require('events');
const axios = require('axios');
const ndjson = require('ndjson');
const sprintf = require('sprintf-js').sprintf;
const TTLCache = require('@isaacs/ttlcache');
const https = require('https');

class PskReporterReceiver extends EventEmitter {
	start() {
		if (config.pskreporter.disabled) {
			return;
		}

		this.spotCache = new TTLCache({ttl: config.pskreporter.quorumInterval});
		this.restartConnection();
	}
	
	restartConnection() {
		if (this.abortController) {
			this.abortController.abort();
		}
		this.abortController = new AbortController();
		this.resetTimer();
		axios({
			url: config.pskreporter.url,
			timeout: config.pskreporter.timeout,
			responseType: 'stream',
			signal: this.abortController.signal,
			httpsAgent: new https.Agent({ keepAlive: false })
		})
		.then(response => {
			response.data
				.on('error', (err) => {
					console.error(`PSK Reporter: connection error (${err}), reconnecting`);
					setTimeout(() => {
						this.restartConnection();
					}, 5000);
				})
				.pipe(ndjson.parse({strict: false}))
				.on('data', (obj) => {
					this.processSpot(obj);
				});
		})
		.catch(err => {
			console.error(`PSK Reporter: connection error (${err}), reconnecting`);
			setTimeout(() => {
				this.restartConnection();
			}, 5000);
		});
	}
	
	resetTimer() {
		if (this.timeout) {
			clearTimeout(this.timeout);
		}
		
		this.timeout = setTimeout(() => {
			console.error("PSK Reporter: timeout, reconnecting");
			setTimeout(() => {
				this.restartConnection();
			}, 5000);
		}, config.pskreporter.timeout);
	}
	
	processSpot(rawSpot) {
		this.resetTimer();
		
		if (!rawSpot.mode) {
			return;
		}

		if (rawSpot.mode == 'CW') {
			return;	// ignore CW spots from PSK reporter; RBN is good enough
		}

		if (rawSpot.mode.startsWith('OLIVIA')) {
			rawSpot.mode = 'OLIVIA';
		}

		if (rawSpot.receiverDecoderSoftware && rawSpot.receiverDecoderSoftware.includes('N1DQ-Importer-KA9Q-Radio')) {
			return; // ignore these as they will usually have made-up spotter calls with strange suffixes
		}
		
		if (!rawSpot.senderCallsign || rawSpot.senderCallsign.startsWith('TNX') || rawSpot.senderCallsign.endsWith('/R') || rawSpot.senderCallsign.endsWith('/RX')) {
			return;
		}

		if (rawSpot.mode === 'WSPR' || rawSpot.mode === 'FST4W') {
			return;
		}

		let spotTime = new Date(rawSpot.flowStartSeconds*1000);
		
		if ((new Date() - spotTime) > config.pskreporter.maxAge) {
			return;	// ignore old spots
		}

		let spot = {
			source: 'pskreporter',
			time: ('0'  + spotTime.getHours()).slice(-2) + ':' + ('0' + spotTime.getMinutes()).slice(-2),
			fullCallsign: rawSpot.senderCallsign,
			spotter: rawSpot.receiverCallsign,
			frequency: rawSpot.frequency/1000000,
			mode: rawSpot.mode,
			spotterSoftware: rawSpot.receiverDecoderSoftware,
			date: spotTime
		};
		if (rawSpot.sNR !== null) {
			spot.snr = parseInt(rawSpot.sNR);
		}
		spot.rawText = `DX de ${spot.spotter}: ${sprintf("%.01f", spot.frequency*1000)} ${spot.fullCallsign} ${spot.mode}`;
		if (spot.snr !== undefined) {
			spot.rawText += ` ${spot.snr} dB`;
		}
		spot.rawText += ` ${spot.time.replace(':', '')}Z`;
		if (spot.spotterSoftware) {
			spot.rawText += ` (${spot.spotterSoftware})`;
		}
		
		spot.title = `PSK Reporter spot ${spot.fullCallsign} (${hamutil.formatFrequency(spot.frequency)} ${spot.mode})`;

		if (!config.pskreporter.spotterFilterRegex.test(rawSpot.receiverCallsign)) {
			console.log(`DXCC lookup blocked for spotter callsign ${rawSpot.receiverCallsign}`);
			spot.noSpotterDxccLookup = true;
		}
		
		this.checkQuorumAndEmit(spot);
	}
	
	checkQuorumAndEmit(spot) {
		let band = config.bands.find((element) => {
			return (element.from <= spot.frequency && element.to >= spot.frequency)
		});
		if (band === undefined) {
			console.log(`PSK Reporter: unknown band for frequency ${spot.frequency}`);
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
		cachedSpots = cachedSpots.filter(cachedSpot => (now - cachedSpot.date) < config.pskreporter.quorumInterval);
		
		// Count number of unique spotters
		let uniqueSpotterCount = cachedSpots.reduce((resultSet, item) => resultSet.add(item.spotter), new Set).size;
		
		if (uniqueSpotterCount >= config.pskreporter.quorum) {
			// Quorum met; emit any held back spots
			let minifiedSpots = [];
			for (let cachedSpot of cachedSpots) {
				if (cachedSpot.emitted) {
					minifiedSpots.push(cachedSpot);
					continue;
				}
				
				if ((now - cachedSpot.date) < config.pskreporter.maxAge) {
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

module.exports = PskReporterReceiver;
