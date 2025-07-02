const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	updateStats(db);
});

async function updateStats(db) {
	// Update yesterday's stats on the number of triggers and users
	let yesterday = new Date();
	yesterday.setDate(yesterday.getDate()-1);
	yesterday = yesterday.toISOString().slice(0, 10);
	
	let numTriggers = await db.collection('triggers').count({});
	let numUsers = await db.collection('users').count({});
	await db.collection('stats').updateOne({date: yesterday}, {$set: {triggers: numTriggers, users: numUsers}}, {upsert: true});
	client.close();
}
