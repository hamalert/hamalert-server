const {MongoClient, ObjectId} = require('mongodb')
const config = require('../config_loader')

let client = new MongoClient(config.mongodb.url)
client.connect().then(async () => {
	let db = client.db(config.mongodb.dbName)

	let cursor = db.collection('triggers').find({matchCount: {"$gt": config.uselessTriggerDetection.matchThreshold}, disabled: {$in: [null, false]}})
	while (await cursor.hasNext()) {
		let trigger = await cursor.next()
		if (trigger.comment === 'no-auto-disable') {
			continue
		}

		await db.collection('triggers').updateOne({_id: new ObjectId(trigger._id)}, {$set: {disabled: true, useless: true}})
	}

	if (process.argv[2] === '--reset') {
		await db.collection('triggers').updateMany({}, {$set: {matchCount: 0}})
	}

	client.close()
}).catch((err) => {
	console.error(err)
	process.exit(1)
})
