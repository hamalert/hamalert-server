const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');
const config = require('../config');

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	let maxDate = new Date(Date.now() - 86400000);
	db.collection('signups').deleteMany({signupDate: {$lt: maxDate}}, null, (err, result) => {
		assert.equal(null, err);
		process.exit(0);
	});
});
