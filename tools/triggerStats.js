const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	makeTriggerStats(db, () => {
		client.close();
	});
});

function makeTriggerStats(db, callback) {
	let stats = {};
	let numTriggers = 0;
	let numConditions = 0;
	let begin = process.hrtime();
	db.collection('triggers').find({}).forEach((trigger) => {
		Object.keys(trigger.conditions).forEach((key) => {
			if (!stats[key]) {
				stats[key] = 1;
			} else {
				stats[key]++;
			}
			numConditions++;
		});
		numTriggers++;
	}, (err) => {
		let diff = process.hrtime(begin);
		console.log(`Fetch took ${(diff[0] * 1e9 + diff[1])/1e9} seconds`);
		console.log(`${numTriggers} triggers, ${numConditions} conditions`);
		
		// make percent
		Object.keys(stats).forEach((key) => {
			let percent = Number(100 * stats[key] / numTriggers).toFixed(1);
			console.log(`${key}: ${percent}%`);
		});
		callback();
	});
}
