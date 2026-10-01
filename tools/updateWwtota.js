const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');

let client = new MongoClient(config.mongodb.url)
client.connect(async (err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);

	await processWwtotaList(db);
	client.close();
});

async function processWwtotaList(db) {
	let response = await axios.get(config.wwtota.listUrl, {
		headers: {
			'User-Agent': 'HamAlert/1.0 (+https://hamalert.org)'
		},
		params: {
			key: config.wwtota.apiKey,
		}
	});

	// Loop through towers
	let towers = [];
	for (let towerInfo of response.data) {
		let tower = {
			'Ref': towerInfo.ref,
			'Name': towerInfo.name,
			'Lat': towerInfo.lat,
			'Lon': towerInfo.lon,
		};

		towers.push(tower);
	}
	
	if (towers.length < 2000) {
		throw new Error("Bad number of WWTOTA towers, expecting more than 2000");
	}

	let collection = db.collection('wwtotaTowers');
	await collection.deleteMany({manual: {$not: {$eq: true}}});
	await collection.insertMany(towers);
}
