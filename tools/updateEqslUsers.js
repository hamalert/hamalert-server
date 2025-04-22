const request = require('request');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');
const fs = require('fs');

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	processEqslUserList(db);
});

function processEqslUserList(db) {	
	request(config.eqsl.userListUrl, (error, response, body) => {
		assert.equal(error, null);
		
		let callsigns = body.split(/\r?\n/).slice(1);
			
		if (callsigns.length < 100000) {
			console.error("Bad number of callsigns, expecting more than 100000");
			client.close();
			return;
		}

		let bulkOperations = [];
		let validCallsign = /^[A-Z0-9\/]+$/;
		for (let callsign of callsigns) {
			callsign = callsign.toUpperCase();
			if (!validCallsign.test(callsign)) {
				continue;
			}

			bulkOperations.push({
				updateOne: {
					filter: {callsign},
					update: { $set: { eqsl: true } },
					upsert: true
				}
			});
		}

		db.collection('callsignInfo').updateMany({eqsl: true}, {$set: {eqsl: false}}, (err, result) => {
			db.collection('callsignInfo').bulkWrite(bulkOperations, (err, result) => {
				if (err)
					console.error(err);
				client.close();
			});
		});
	});
}
