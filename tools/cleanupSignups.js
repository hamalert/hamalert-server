const {MongoClient} = require('mongodb');
const config = require('../config_loader');

let client = new MongoClient(config.mongodb.url)
client.connect().then(async () => {
	let db = client.db(config.mongodb.dbName);
	let maxDate = new Date(Date.now() - 86400000);
	await db.collection('signups').deleteMany({signupDate: {$lt: maxDate}});
	process.exit(0);
}).catch((err) => {
	console.error(err);
	process.exit(1);
});
