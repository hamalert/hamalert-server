const axios = require('axios');
const config = require('./config');
const EventEmitter = require('events');
const util = require('util');
const crypto = require('crypto');
const sprintf = require('sprintf');

class WwtotaSpotReceiver extends EventEmitter {
	constructor(db) {
		super();
		this.db = db;
		this.lastProcessedTime = null;
	}

	start() {
		setInterval(() => {
			this.refreshSpots();
		}, config.wwtota.refreshInterval);
		this.refreshSpots();
	}

	async refreshSpots() {
		console.log("Refreshing WWTOTA JSON feed");

		let response = await axios.get(config.wwtota.spotsUrl, {
			headers: {
				'User-Agent': 'HamAlert/1.0 (+https://hamalert.org)'
			},
			params: {
				key: config.wwtota.apiKey,
			}
		})
		if (response.status !== 200) {
			throw `Bad status code ${response.statusCode} from WWTOTA`;
		}

		if (!Array.isArray(response.data.spots)) {
			throw `Expected array from WWTOTA, but got something else`;
		}

		// reverse to process oldest to newest
		response.data.spots.reverse()
		response.data.spots.forEach(spot => {
			this.processJsonSpot(spot)
		});
		if (response.data.spots.length > 0) {
			this.lastProcessedTime = response.data.spots[response.data.spots.length - 1].time;  // Previously reversed, so newest last
		}
	}

	processJsonSpot(jsonSpot) {
		try {
			jsonSpot.time = new Date(jsonSpot.time_utc);

			// Check if spot newer that last batch processed
			// edited spot have new timestamp as well
			if (this.lastProcessedTime && this.lastProcessedTime >= jsonSpot.time) {
				return;
			}

			// Ignore old spots
			if ((new Date() - jsonSpot.spotTime) > config.wwtota.spotMaxAge) {
				return;
			}

			jsonSpot.callsign = jsonSpot.callsign.toUpperCase().replace(/\s/g, '');

			// Clean up frequency
			let frequency = sprintf("%.4f", jsonSpot.frequency / 1000);
			let spot = {
				source: 'wwtota',
				time: jsonSpot.time.toISOString().substring(11, 16),
				fullCallsign: jsonSpot.callsign,
				wwtotaRef: jsonSpot.tower_ref,
				wwtotaName: jsonSpot.tower_name,
				frequency,
				mode: jsonSpot.mode.toLowerCase().trim(),
				comment: "",
				spotter: jsonSpot.spotter.toUpperCase().trim().replace('-#', '')
			};

			spot.rawText = `${spot.time} ${spot.fullCallsign} in ${spot.wwtotaRef} (${spot.wwtotaName}) ${spot.frequency}`;
			if (spot.mode) {
				spot.rawText += ` ${spot.mode.toUpperCase()}`;
			}
			if (spot.comment) {
				spot.rawText += `: ${spot.comment}`;
			}
			spot.title = `WWTOTA ${spot.fullCallsign} in ${spot.wwtotaRef} (${spot.frequency}`;
			if (spot.mode) {
				spot.title += " " + spot.mode.toUpperCase();
			}
			spot.title += ")";

			//console.log(spot);
			this.emit("spot", spot);

		} catch (e) {
			console.error("Exception while processing WWTOTA spot", e);
		}
	}
}

let rec = new WwtotaSpotReceiver();
rec.start();

module.exports = WwtotaSpotReceiver;
