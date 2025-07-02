const axios = require('axios');
const config = require('./config');
const EventEmitter = require('events');
const util = require('util');
const crypto = require('crypto');
const sprintf = require('sprintf');

const testRegex = /\btest(ing)?\b/i;
const potaLocationStateRegex = /^((US|CA)-..,?)+$/;

class PotaSpotReceiver extends EventEmitter {
	constructor(db) {
		super();
		this.db = db;
		this.idCache = new Map();
	}
	
	start() {
		setInterval(() => {
			this.refreshSpots();
		}, config.pota.refreshInterval);
		this.refreshSpots();
	}
	
	refreshSpots() {
		console.log("Refreshing POTA JSON feed");
		
		let req = axios({
			url: config.pota.spotsUrl,
			headers: {
				'User-Agent': 'HamAlert/1.0 (+https://hamalert.org)'
			},
			responseType: 'json',
			method: 'GET'
		})
		.then(response => {
			let body = response.data;
			if (!Array.isArray(body)) {
				console.error(`Expected array from POTA, but got something else`);
				return;
			}
			body.forEach(spot => {
				this.processJsonSpot(spot)
			});
		})
		.catch(error => {
			console.error(`Loading POTA feed failed: ${error}`);
		});
	}
	
	processJsonSpot(jsonSpot) {
		try {
			jsonSpot.spotTime = new Date(jsonSpot.spotTime);
			
			// Hash contents so we can treat edited spots as new
			let hash = crypto.createHash('sha256');
			hash.update(`${jsonSpot.spotTime}\n${jsonSpot.activator}\n${jsonSpot.reference}\n${jsonSpot.frequency}\n${jsonSpot.mode}\n${jsonSpot.comments}`);
			let digest = hash.digest('hex');
			
			// Check if we already have this ID and digest
			if (this.idCache.get(jsonSpot.spotId) === digest) {
				return;
			}
			
			// Ignore old spots
			if ((new Date() - jsonSpot.spotTime) > config.pota.spotMaxAge) {
				return;
			}
			
			jsonSpot.activator = jsonSpot.activator.toUpperCase().replace(/\s/g, '');
			
			if (jsonSpot.comments === null) {
				jsonSpot.comments = "";
			}
			
			// Ignore test spots
			if (testRegex.test(jsonSpot.comments)) {
				console.error(`POTA spot looks like test - ignoring ("${jsonSpot.comments}")`);
				return;
			}
			
			// Clean up frequency
			let frequency = sprintf("%.4f", parseFloat(jsonSpot.frequency) / 1000);

			// Extract park division/reference
			let [wwffDivision, wwffNum] = jsonSpot.reference.split('-');

			let spot = {
				source: 'pota',
				time: jsonSpot.spotTime.toISOString().substring(11, 16),
				fullCallsign: jsonSpot.activator,
				wwffDivision,
				wwffRef: jsonSpot.reference,
				wwffName: jsonSpot.name,
				wwffProgram: 'pota',
				frequency,
				mode: jsonSpot.mode.toLowerCase().trim(),
				comment: jsonSpot.comments.trim(),
				spotter: jsonSpot.spotter.toUpperCase().trim().replace('-#', '')
			};

			spot.rawText = `${spot.time} ${spot.fullCallsign} in ${spot.wwffRef} (${spot.wwffName}) ${spot.frequency}`;
			if (spot.mode) {
				spot.rawText += ` ${spot.mode.toUpperCase()}`;
			}			
			if (spot.comment) {
				spot.rawText += `: ${spot.comment}`;
			}
			spot.title = `POTA ${spot.fullCallsign} in ${spot.wwffRef} (${spot.frequency}`;
			if (spot.mode) {
				spot.title += " " + spot.mode.toUpperCase();
			}
			spot.title += ")";

			// Look up US state
			if (potaLocationStateRegex.test(jsonSpot.locationDesc)) {
				spot.state = jsonSpot.locationDesc.split(',').map(str => str.replace('-', '_'));
			}
			
			//console.log(spot);
			this.emit("spot", spot);
		
			this.idCache.set(jsonSpot.spotId, digest);
		} catch (e) {
			console.error("Exception while processing POTA spot", e);
		}
	}
}

let rec = new PotaSpotReceiver();
rec.start();

module.exports = PotaSpotReceiver;
