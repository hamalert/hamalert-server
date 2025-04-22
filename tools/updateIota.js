const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');

let client = new MongoClient(config.mongodb.url)
client.connect(async (err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	await processIotaList(db);
	client.close();
});

async function processIotaList(db) {
	var parks = [];
	var divisions = new Map();
	
	let response = await axios.get(config.iotaListUrl);
	
	// Loop through groups
	let iotaGroups = [];
	for (let groupInfo of response.data) {
		let iotaGroup = {
			'grpRef': groupInfo.refno,
			'grpName': groupInfo.name,
			'dxcc': parseInt(groupInfo.dxcc_num)
		};
		if (groupInfo.comment) {
			iotaGroup.grpComment = groupInfo.comment;
		}
		
		iotaGroups.push(iotaGroup);
	}
	
	if (iotaGroups.length < 1000) {
		throw new Error("Bad number of IOTA groups, expecting more than 1000");
	}
	
	let collection = db.collection('iotaGroups');
	await collection.deleteMany({manual: {$not: {$eq: true}}});
	await collection.insertMany(iotaGroups);
}
