const axios = require('axios');
const config = require('./config');
const EventEmitter = require('events');
const util = require('util');
const crypto = require('crypto');

var rbnHoleSpotterRegex = /\[RBNHole\]\s+at\s+(\S+)\s/;
var testRegex = /\btest(ing)?\b/i;

class SotaSpotReceiver extends EventEmitter {
	constructor(db) {
		super();
		this.db = db;
		this.idCache = new Map();
		this.lastEpoch = null;
	}
	
	start() {
		setInterval(() => {
			this.refreshSpots();
		}, config.sotaWatch.refreshInterval);
		this.refreshSpots();
	}
	
	async refreshSpots() {
		try {
			// Check epoch first
			let epoch = (await axios.get(config.sotaWatch.epochUrl)).data
			if (epoch !== this.lastEpoch) {
				console.log("Refreshing SOTAwatch JSON feed");
				let response = await axios.get(config.sotaWatch.spotsUrl)
				if (response.status !== 200) {
					throw `Bad status code ${response.statusCode} from SOTAwatch`;
				}

				if (!Array.isArray(response.data)) {
					throw `Expected array from SOTAwatch, but got something else`;
				}

				// Order by id ascending, so we will process earlier spots first
				response.data.sort((a, b) => {
					return a.id - b.id;
				});
				
				response.data.forEach(spot => {
					this.processJsonSpot(spot)
					this.lastEpoch = spot.epoch
				});
			}
		} catch (error) {
			console.error(`Loading SOTAwatch feed failed: ${error}`);
		}
	}
	
	processJsonSpot(jsonSpot) {
		try {
			jsonSpot.timeStamp = new Date(jsonSpot.timeStamp);
			
			// Hash contents so we can treat edited spots as new
			let hash = crypto.createHash('sha256');
			hash.update(`${jsonSpot.timeStamp}\n${jsonSpot.activatorCallsign}\n${jsonSpot.summitCode}\n${jsonSpot.frequency}\n${jsonSpot.mode}\n${jsonSpot.comments}`);
			let digest = hash.digest('hex');
			
			// Check if we already have this ID and digest
			if (this.idCache.get(jsonSpot.id) === digest) {
				return;
			}
			
			// Ignore old spots
			if ((new Date() - jsonSpot.timeStamp) > config.sotaWatch.spotMaxAge) {
				return;
			}

			// Ignore non-normal (test, QRT) spots
			if (jsonSpot.type && jsonSpot.type !== "NORMAL") {
				console.log(`Ignoring SOTAwatch spot of type ${jsonSpot.type}`);
				return;
			}
			
			jsonSpot.activatorCallsign = jsonSpot.activatorCallsign.toUpperCase().replace(/\s/g, '');
			
			if (jsonSpot.comments === null) {
				jsonSpot.comments = "";
			}
			jsonSpot.comments = jsonSpot.comments.replace(/^(\. |\*)/, '').trim();
			if (jsonSpot.comments == '(null)') {
				jsonSpot.comments = '';
			}
			
			// Ignore test spots
			if (testRegex.test(jsonSpot.comments)) {
				console.error(`SOTAwatch spot looks like test - ignoring ("${jsonSpot.description}")`);
				return;
			}

			let spot = {
				source: 'sotawatch',
				time: jsonSpot.timeStamp.toISOString().substring(11, 16),
				fullCallsign: jsonSpot.activatorCallsign,
				summitRef: jsonSpot.summitCode.toUpperCase().trim(),
				frequency: jsonSpot.frequency,
				mode: jsonSpot.mode.toLowerCase().trim(),
				comment: jsonSpot.comments.trim(),
				spotter: jsonSpot.callsign.toUpperCase().trim()
			};

			if (spot.spotter == 'RBNHOLE') {
				let rbnHoleMatches = rbnHoleSpotterRegex.exec(jsonSpot.comments);
				if (rbnHoleMatches) {
					spot.spotter = rbnHoleMatches[1];
				}
			}
			
			// Look up summit ref in database and insert summit name in raw text
			this.db.collection('summits').findOne({SummitCode: spot.summitRef}, {}, (err, summit) => {
				spot.rawText = `${spot.time} ${spot.fullCallsign} on ${spot.summitRef}`;
				
				if (summit) {
					spot.summitName = summit.SummitName;
					// Check validity
					let now = new Date();
					if (summit.ValidFrom > now || summit.ValidTo < now) {
						console.log(`Summit ${spot.summitRef} is currently not valid`);
						spot.summitName += ` [invalid]`;
					}

					spot.summitHeight = parseInt(summit.AltM);
					spot.summitPoints = parseInt(summit.Points);
					spot.summitActivations = parseInt(summit.ActivationCount);
					spot.rawText += ` (${spot.summitName}, ${spot.summitHeight}m, ${spot.summitPoints}pt)`;
				} else {
					console.error(`Summit ${spot.summitRef} not found in database`);
					spot.rawText += ` (summit not found in database)`;
				}
				
				spot.rawText += ` ${spot.frequency}`;
				if (spot.mode) {
					spot.rawText += ` ${spot.mode.toUpperCase()}`;
				}			
				if (spot.comment) {
					spot.rawText += `: ${spot.comment}`;
				}
				
				spot.title = `SOTA ${spot.fullCallsign} on ${spot.summitRef} (${spot.frequency}`;
				if (spot.mode) {
					spot.title += " " + spot.mode.toUpperCase();
				}
				spot.title += ")";
			
				//console.log(spot);
				this.emit("spot", spot);
			
				this.idCache.set(jsonSpot.id, digest);
			});
		} catch (e) {
			console.error("Exception while processing SOTA spot", e);
		}
	}
}

module.exports = SotaSpotReceiver;
