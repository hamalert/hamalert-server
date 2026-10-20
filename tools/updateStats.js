const {MongoClient} = require('mongodb');
const config = require('../config_loader');

let client = new MongoClient(config.mongodb.url)
client.connect().then(async () => {
	let db = client.db(config.mongodb.dbName);
	await updateStats(db);
}).catch((err) => {
	console.error(err);
	process.exit(1);
});

async function updateStats(db) {
	// Update yesterday's stats on the number of triggers and users
	let yesterday = new Date();
	yesterday.setDate(yesterday.getDate()-1);
	yesterday = yesterday.toISOString().slice(0, 10);
	
	let numTriggers = await db.collection('triggers').countDocuments({});
	let numUsers = await db.collection('users').countDocuments({});
	await db.collection('stats').updateOne({date: yesterday}, {$set: {triggers: numTriggers, users: numUsers}}, {upsert: true});
	client.close();
}
