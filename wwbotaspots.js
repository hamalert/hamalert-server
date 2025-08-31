const eventsource = require('eventsource');
const config = require('./config');
const EventEmitter = require('events');
const sprintf = require('sprintf');

class WwbotaSpotReceiver extends EventEmitter {
	constructor(db) {
		super();
		this.db = db;
		this.lastProcessedTime = null;
	}
	
	start() {
		let es = new eventsource.EventSource(config.wwbota.spotsUrl,{
			fetch: (input, init) =>
				fetch(input, {
				...init,
				headers: {
					...init.headers,
					'User-Agent': 'HamAlert/1.0 (+https://hamalert.org)',
				},
				}),
		});
		es.addEventListener('message', (event) => this.processSpotEvent(event));
		es.addEventListener('error', (error) => {
			console.error(`Loading WWBOTA feed failed: ${error.responseCode}`)
		})
	}
	
	processSpotEvent(spotEvent) {
		try {
			let jsonSpot = JSON.parse(spotEvent.data);
			jsonSpot.time = new Date(jsonSpot.time);

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
				wwbotaScheme: jsonSpot.references[0].scheme, // Multiple, but lets just take the first.
				wwbotaRef: jsonSpot.references[0].reference,
				wwbotaName: jsonSpot.references[0].name,
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
