const SotaSpotReceiver = require('../sotaspots');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');

//config.sotaWatch.spotsUrl = 'http://api2.sota.org.uk/api/spots/500/all';
//config.sotaWatch.spotMaxAge = 999999999999;

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	var spotReceiver = new SotaSpotReceiver(db);
	spotReceiver.on('spot', spot => {
		console.dir(spot);
	});
	spotReceiver.start();
});
