const axios = require('axios');
const https = require('https');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');

let client = new MongoClient(config.mongodb.url)
client.connect(async (err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	// Grab list of all DXCC IDs first
	let dxccs = await db.collection('dxccs').find({}).toArray();
	let dxccIds = dxccs.map((dxcc) => {
		return dxcc.dxcc;
	});

	await updateBandslots(db, dxccIds);

	client.close();
});

async function updateBandslots(db, dxccIds) {
	
	let tasks = [];
	let cursor = await db.collection('triggers').find({
			"conditions.bandslot": {"$exists": true},
			'$or': [
				{'options.clublog.lastUpdate': {'$lt': new Date((new Date().getTime() - 86400000))}},
				{'options.clublog.lastUpdate': {'$exists': false}},
				{'options.clublog.forceUpdate': true}
			]
		});

	while (await cursor.hasNext()) {
		let trigger = await cursor.next();
		await updateBandslotsForTrigger(db, dxccIds, trigger);
	}
}

async function updateBandslotsForTrigger(db, dxccIds, trigger) {
	let user = await db.collection('users').findOne({_id: trigger.user_id})
		
	if (!trigger.conditions.band || !trigger.options || !trigger.options.clublog.callsign || !trigger.options.clublog.status || !trigger.options.clublog.modes || !user.clublog || !user.clublog.email || !user.clublog.password || user.clublog.invalid) {
		return;
	}
	
	let mode = config.clublog.modeValues[trigger.options.clublog.modes];
	
	let desiredBands = makeDesiredBandList(trigger);
	
	let desiredQslStatus = trigger.options.clublog.status.map((status) => {
		return config.clublog.qslStatusValues[status];
	});
	
	let agent = new https.Agent(/*{ family: 6 }*/);
	let response = await axios.get('https://clublog.org/json_dxccchart.php', {
		params: {
			email: user.clublog.email,
			password: user.clublog.password,
			call: trigger.options.clublog.callsign,
			api: config.clublog.apiKey,
			mode: mode
		},
		httpsAgent: agent,
		validateStatus: null
	});

	if (response.status === 403 || response.data === 'Unable to validate password or app password') {
		// Bad password - mark Club Log account as invalid so we won't try again
		await db.collection('users').updateOne({_id: user._id}, {'$set': {'clublog.invalid': true}});
		return;
	}
	
	// Compile list of missing bandslots
	let bandslots = [];
	for (let dxccId of dxccIds) {
		let missingBands = desiredBands;
		
		// Remove all bands where Club Log indicates the desired status
		let clubLogBands = response.data[dxccId];
		if (clubLogBands) {
			missingBands = missingBands.filter((band) => {
				if (clubLogBands[band] && desiredQslStatus.includes(clubLogBands[band]))
					return false;
				return true;
			});
		}
		
		for (let missingBand of missingBands) {
			if (missingBand == 70 || missingBand == 23 || missingBand == 13)
				missingBand = missingBand + 'cm';
			else
				missingBand = missingBand + 'm';
			bandslots.push(dxccId + '_' + missingBand);
		}
	}
	
	// Update trigger with missing bandslots
	await db.collection('triggers').updateOne({_id: trigger._id},
		{
			'$set': {'conditions.bandslot': bandslots, 'options.clublog.lastUpdate': new Date()},
			'$unset': {'options.clublog.forceUpdate': ''}
		});
}

function makeDesiredBandList(trigger) {
	// Compile list of desired bands for this trigger
	let desiredBands = [];
	let triggerBands = trigger.conditions.band;
	if (!Array.isArray(triggerBands))
		triggerBands = [triggerBands];
	for (let band of triggerBands) {
		if (config.bandRangesToBands[band]) {
			desiredBands.push(...config.bandRangesToBands[band]);
		} else {
			desiredBands.push(band);
		}
	}
	
	desiredBands = desiredBands.map((band) => {
		return band.replace(/[^0-9]/, "");
	});
	
	return desiredBands;
}
