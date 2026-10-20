const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config_loader');
const fs = require('fs');

let client = new MongoClient(config.mongodb.url)
client.connect().then(() => {
	let db = client.db(config.mongodb.dbName);
	
	processEqslUserList(db);
}).catch((err) => {
	console.error(err);
	process.exit(1);
});

function processEqslUserList(db) {	
	axios.get(config.eqsl.userListUrl, {responseType: 'text'})
		.then(response => {
			let body = response.data;
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
			db.collection('callsignInfo').updateMany({eqsl: true}, {$set: {eqsl: false}}).catch((err) => {
				console.error(err);
			}).then(() => {
				return db.collection('callsignInfo').bulkWrite(bulkOperations);
			}).catch((err) => {
				console.error(err);
			}).finally(() => {
				client.close();
			});
		})
		.catch(error => {
			console.error(error);
			client.close();
		});
}
