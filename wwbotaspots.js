const request = require('request');
const config = require('./config');
const EventEmitter = require('events');
const util = require('util');
const crypto = require('crypto');
const sprintf = require('sprintf');

class WwbotaSpotReceiver extends EventEmitter {
	constructor(db) {
		super();
		this.db = db;
		this.lastProcessedTime = null;
	}
	
	start() {
		setInterval(() => {
			this.refreshSpots();
		}, config.wwbota.refreshInterval);
		this.refreshSpots();
	}
	
	refreshSpots() {
		console.log("Refreshing WWBOTA JSON feed");
		
		let req = request({
			url: config.wwbota.spotsUrl,
			headers: {
				'User-Agent': 'HamAlert/1.0 (+https://hamalert.org)'
			},
			json: true
		}, (error, response, body) => {
			if (error) {
				console.error(`Loading WWBOTA feed failed: ${error}`);
				return;
			}

			if (response.statusCode !== 200) {
				console.error(`Bad status code ${response.statusCode} from WWBOTA`);
				return;
			}

			if (!Array.isArray(body)) {
				console.error(`Expected array from WWBOTA, but got something else`);
				return;
			}
			
			// reverse to process oldest to newest
			body.reverse()
			body.forEach(spot => {
				this.processJsonSpot(spot)
			});
			if (body.length > 0) {
				this.lastProcessedTime = spot[body.length - 1].time;  // Previously reversed, so newest last
			}
		});
	}
	
	processJsonSpot(jsonSpot) {
		try {
			jsonSpot.time = new Date(jsonSpot.time);
			
			// Check if spot newer that last batch processed
			// edited spot have new timestamp as well
			if (this.lastProcessedTime && this.lastProcessedTime >= jsonSpot.time) {
				return;
			}
			
			// Ignore old spots
			if ((new Date() - jsonSpot.spotTime) > config.wwbota.spotMaxAge) {
				return;
			}

			// Ignore QRT/Test spots
			if (jsonSpot.type !== "Live") {
				return;
			}
			
			jsonSpot.call = jsonSpot.call.toUpperCase().replace(/\s/g, '');
			
			if (jsonSpot.comment === null) {
				jsonSpot.comment = "";
			}
			
			// Clean up frequency
			let frequency = sprintf("%.4f", jsonSpot.freq);

			let spot = {
				source: 'wwbota',
				time: jsonSpot.time.toISOString().substring(11, 16),
				fullCallsign: jsonSpot.call,
				wwbotaScheme: spot.reference[0].scheme, // Multiple, but lets just take the first.
				wwbotaRef: spot.reference[0].reference,
				wwbotaName: spot.reference[0].name,
				frequency,
				mode: jsonSpot.mode.toLowerCase().trim(),
				comment: jsonSpot.comment.trim(),
				spotter: jsonSpot.spotter.toUpperCase().trim().replace('-#', '')
			};

			spot.rawText = `${spot.time} ${spot.fullCallsign} in ${spot.wwbotaRef} (${spot.wwbotaName}) ${spot.frequency}`;
			if (spot.mode) {
				spot.rawText += ` ${spot.mode.toUpperCase()}`;
			}			
			if (spot.comment) {
				spot.rawText += `: ${spot.comment}`;
			}
			spot.title = `WWBOTA ${spot.fullCallsign} in ${spot.wwbotaRef} (${spot.frequency}`;
			if (spot.mode) {
				spot.title += " " + spot.mode.toUpperCase();
			}
			spot.title += ")";

			//console.log(spot);
			this.emit("spot", spot);
		
		} catch (e) {
			console.error("Exception while processing WWBOTA spot", e);
		}
	}
}

let rec = new WwbotaSpotReceiver();
rec.start();

module.exports = WwbotaSpotReceiver;
