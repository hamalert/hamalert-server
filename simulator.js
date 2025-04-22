const config = require('./config');
const EventEmitter = require('events');
const express = require('express');
const bodyParser = require('body-parser');
const util = require('util');
const hamutil = require('./hamutil');

/*
	Receive simulated spots from web interface on localhost port.
	Spots should go to /sendSpot and use the following JSON format:

	{
		"user_id": "586ff45b10a3c6d9c2bb11cf",
		"source": "sotawatch",
		"fullCallsign": "DL/HB9DQM/P",
		"spotter": "HB9FVF",
		"summitRef": "HB/ZH-015",
		"frequency": 14.062,
		"mode": "cw"
	}
*/
class SimulatorReceiver extends EventEmitter {
	constructor(db) {
		super();
		this.db = db;
		this.app = express();
		this.app.use(bodyParser.json());
		
		this.app.post('/sendSpot', (req, res) => {
			this.handleSendSpot(req, res);
		});	
	}
	
	start() {
		this.app.listen(config.simulator.port, config.simulator.address);
	}
	
	handleSendSpot(req, res) {
		if (!req.body.user_id || !req.body.source || !req.body.fullCallsign || !req.body.frequency || !req.body.mode) {
			res.status(400).end();
			return;
		}
		
		let spot = {
			user_id: req.body.user_id,
			source: req.body.source,
			time: new Date().toISOString().substring(11, 16),
			fullCallsign: req.body.fullCallsign,
			frequency: req.body.frequency,
			mode: req.body.mode
		};
		
		spot.title = `SIMULATED spot ${spot.fullCallsign} (${hamutil.formatFrequency(spot.frequency)} ${spot.mode.toUpperCase()})`;
		spot.rawText = `SIMULATED SPOT: ${spot.time} ${spot.fullCallsign} (${hamutil.formatFrequency(spot.frequency)} ${spot.mode.toUpperCase()}), from ${spot.source}`;
		
		if (req.body.spotter) {
			spot.spotter = req.body.spotter;
			spot.rawText += `, spotted by ${spot.spotter}`;
		}
		
		if (req.body.comment) {
			spot.comment = req.body.comment;
			spot.rawText += ': ' + spot.comment;
		}
		
		if (req.body.summitRef) {
			spot.summitRef = req.body.summitRef;
			this.db.collection('summits').findOne({SummitCode: spot.summitRef}, {}, (err, summit) => {
				spot.rawText += `, on ${spot.summitRef}`;
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
				
				this.emit("spot", spot);
				res.status(200).end();
			});
		} else {
			this.emit("spot", spot);
			res.status(200).end();
		}
	}
}

module.exports = SimulatorReceiver;
