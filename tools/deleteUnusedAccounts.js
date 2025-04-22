const MongoClient = require('mongodb').MongoClient
const nodemailer = require('nodemailer')
const assert = require('assert')
const config = require('../config')

let client = new MongoClient(config.mongodb.url)
client.connect(async (err) => {
	assert.equal(null, err)
	let db = client.db(config.mongodb.dbName)
	
	let transporter = nodemailer.createTransport(config.mail.transport)

	let maxDate = new Date(Date.now() - config.accountPruning.deleteInterval)
	const cursor = await db.collection('users').find({lastLogin: {"$lt": maxDate}, loginReminderDate: {"$gt": maxDate}, noDelete: {$ne: true}})
	while (await cursor.hasNext()) {
		let user = await cursor.next()

		//console.log(`Delete: ${user.username} ${user.accountEmail} (lastLogin: ${user.lastLogin}, loginReminderDate: ${user.loginReminderDate})`)

		let mail = {
			from: 'do-not-reply@hamalert.org',
			to: user.accountEmail,
			subject: 'HamAlert account deleted',
			text: `Dear HamAlert user,

As announced about a month ago, your HamAlert account with the username
"${user.username}" has now been deleted as there has been no login with it
for more than half a year.

You will thus no longer receive any alerts with this account. If you would
like to use HamAlert again in the future, simply create a new account (you can
use the same username/callsign), and set up your triggers again.

vy 73,

The HamAlert team
`
		}

		await transporter.sendMail(mail)
		await db.collection('users').deleteOne({_id: user._id})
		await db.collection('triggers').deleteMany({user_id: user._id})
	}

	client.close()
})
