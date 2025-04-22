const request = require('request');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');
const parse = require('csv-parse');
const fs = require('fs');
const moment = require('moment');

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	processLotwUserList(db);
});

function processLotwUserList(db) {	
	request(config.lotw.userListUrl, (error, response, body) => {
		assert.equal(error, null);
		
		parse(body, {columns: ['callsign', 'date', 'time']}, function(err, users) {
			assert.equal(err, null);
			
			if (users.length < 100000) {
				console.error("Bad number of users, expecting more than 100000");
				client.close();
				return;
			}
			
			let minDate = moment().subtract(config.lotw.minActivityDays, 'days');
			let activeUsers = users.filter(user => {
				let day = moment(user.date);
				return day.isAfter(minDate);
			});

			let bulkOperations = [];
			for (let user of activeUsers) {
				bulkOperations.push({
					updateOne: {
						filter: {callsign: user.callsign.toUpperCase()},
						update: { $set: { lotw: true } },
						upsert: true
					}
				});
			}

			db.collection('callsignInfo').updateMany({lotw: true}, {$set: {lotw: false}}, (err, result) => {
				db.collection('callsignInfo').bulkWrite(bulkOperations, (err, result) => {
					if (err)
						console.error(err);
					client.close();
				});
			});
		});
	});
}
