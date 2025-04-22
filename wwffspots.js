const request = require('request');
const config = require('./config');
const EventEmitter = require('events');
const util = require('util');
const crypto = require('crypto');
const sprintf = require('sprintf');

const testRegex = /\btest(ing)?\b/i;

class WwffSpotReceiver extends EventEmitter {
	constructor(db) {
		super();
		this.db = db;
		this.seenSpots = new Set();
	}
	
	start() {
		setInterval(() => {
			this.refreshSpots();
		}, config.wwff.refreshInterval);
		this.refreshSpots();
	}
	
	refreshSpots() {
		console.log("Refreshing WWFFwatch JSON feed");
		
		let req = request({
			url: config.wwff.spotsUrl,
			headers: {
				'User-Agent': 'HamAlert/1.0 (+https://hamalert.org)'
			},
			json: true
		}, (error, response, body) => {
			if (error) {
				console.error(`Loading WWFFwatch feed failed: ${error}`);
				return;
			}

			if (response.statusCode !== 200) {
				console.error(`Bad status code ${response.statusCode} from WWFFwatch`);
				return;
			}

			if (!Array.isArray(body.RCD)) {
				console.error(`Expected array RCD from WWFFwatch, but got something else`);
				return;
			}
			
			body.RCD.forEach(spot => {
				this.processJsonSpot(spot)
			});
		});
	}
	
	processJsonSpot(jsonSpot) {
		try {
			if (jsonSpot.SOURCE !== 'wwff' && jsonSpot.SOURCE !== 'gma') {
				return;
			}

			jsonSpot.spotTime = new Date(jsonSpot.DATE.substring(0, 4) + '-' + jsonSpot.DATE.substring(4, 6) + '-' + jsonSpot.DATE.substring(6, 8) + 'T' +
				jsonSpot.TIME.substring(0, 2) + ':' + jsonSpot.TIME.substring(2, 4) + ':00Z');
			
			// Hash contents so we can ignore old spots
			let hash = crypto.createHash('sha256');
			hash.update(`${jsonSpot.DATE}\n${jsonSpot.TIME}\n${jsonSpot.SPOTTER}\n${jsonSpot.ACTIVATOR}\n${jsonSpot.REF}\n${jsonSpot.QRG}\n${jsonSpot.MODE}`);
			let digest = hash.digest('hex');
			
			// Check if we already have this digest
			if (this.seenSpots.has(digest)) {
				return;
			}
			
			// Ignore old spots
			if ((new Date() - jsonSpot.spotTime) > config.wwff.spotMaxAge) {
				return;
			}
			
			if (jsonSpot.TEXT === null || jsonSpot.TEXT === '""') {
				jsonSpot.TEXT = "";
			}
			
			// Ignore test spots
			if (testRegex.test(jsonSpot.TEXT)) {
				console.error(`WWFFwatch spot looks like test - ignoring ("${jsonSpot.TEXT}")`);
				return;
			}
			
			// Clean up frequency
			let frequency = sprintf("%.4f", parseFloat(jsonSpot.QRG) / 1000);

			// Extract park division/reference
			let [wwffDivision, wwffNum] = jsonSpot.REF.split('-');

			let spot = {
				source: 'wwff',
				time: jsonSpot.spotTime.toISOString().substring(11, 16),
				fullCallsign: jsonSpot.ACTIVATOR.toUpperCase(),
				wwffDivision,
				wwffRef: jsonSpot.REF,
				wwffName: jsonSpot.NAME,
				wwffProgram: 'wwff',
				frequency,
				mode: jsonSpot.MODE.toLowerCase().trim(),
				comment: jsonSpot.TEXT.trim().replace('[wwff] ', ''),
				spotter: jsonSpot.SPOTTER.toUpperCase().trim().replace('-#', '')
			};

			spot.rawText = `${spot.time} ${spot.fullCallsign} in ${spot.wwffRef} (${spot.wwffName}) ${spot.frequency}`;
			if (spot.mode) {
				spot.rawText += ` ${spot.mode.toUpperCase()}`;
			}			
			if (spot.comment) {
				spot.rawText += `: ${spot.comment}`;
			}
			spot.title = `WWFF ${spot.fullCallsign} in ${spot.wwffRef} (${spot.frequency}`;
			if (spot.mode) {
				spot.title += " " + spot.mode.toUpperCase();
			}
			spot.title += ")";
			
			//console.log(spot);
			this.emit("spot", spot);
		
			this.seenSpots.add(digest);
		} catch (e) {
			console.error("Exception while processing WWFFwatch spot", e);
		}
	}
}

let rec = new WwffSpotReceiver();
rec.start();

module.exports = WwffSpotReceiver;
