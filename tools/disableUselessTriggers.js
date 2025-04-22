const MongoClient = require('mongodb').MongoClient
const ObjectID = require('mongodb').ObjectID
const assert = require('assert')
const config = require('../config')

let client = new MongoClient(config.mongodb.url)
client.connect(async (err) => {
	assert.equal(null, err)
	let db = client.db(config.mongodb.dbName)

	let cursor = db.collection('triggers').find({matchCount: {"$gt": config.uselessTriggerDetection.matchThreshold}, disabled: {$in: [null, false]}})
	while (await cursor.hasNext()) {
		let trigger = await cursor.next()
		if (trigger.comment === 'no-auto-disable') {
			continue
		}

		await db.collection('triggers').updateOne({_id: ObjectID(trigger._id)}, {$set: {disabled: true, useless: true}})
	}

	if (process.argv[2] === '--reset') {
		await db.collection('triggers').updateMany({}, {$set: {matchCount: 0}})
	}

	client.close()
})
