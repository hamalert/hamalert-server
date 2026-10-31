const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config_loader');
const assert = require('assert');
const { parse } = require('csv-parse');
const fs = require('fs');
const moment = require('moment');

let client = new MongoClient(config.mongodb.url)
client.connect().then(() => {
	let db = client.db(config.mongodb.dbName);
	
	processLotwUserList(db);
}).catch((err) => {
	console.error(err);
	process.exit(1);
});

function processLotwUserList(db) {	
	axios.get(config.lotw.userListUrl, {responseType: 'text', headers: {'User-Agent': config.userAgent}})
		.then(response => {
			parse(response.data, {columns: ['callsign', 'date', 'time']}, function(err, users) {
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
				db.collection('callsignInfo').updateMany({lotw: true}, {$set: {lotw: false}}).catch((err) => {
					console.error(err);
				}).then(() => {
					return db.collection('callsignInfo').bulkWrite(bulkOperations);
				}).catch((err) => {
					console.error(err);
				}).finally(() => {
					client.close();
				});
			});
		})
		.catch(error => {
			console.error(error);
			client.close();
		});
}
