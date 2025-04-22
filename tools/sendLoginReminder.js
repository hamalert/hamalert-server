const MongoClient = require('mongodb').MongoClient;
const nodemailer = require('nodemailer');
const assert = require('assert');
const config = require('../config');

let client = new MongoClient(config.mongodb.url)
client.connect(async (err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	let transporter = nodemailer.createTransport(config.mail.transport);

	let maxDate = new Date(Date.now() - config.accountPruning.reminderInterval);
	const cursor = await db.collection('users').find({lastLogin: {"$lt": maxDate}, "$or": [{loginReminderDate: {"$lt": maxDate}}, {loginReminderDate: undefined}], noDelete: {$ne: true}})

	while (await cursor.hasNext()) {
		let user = await cursor.next()
		let mail = {
			from: 'do-not-reply@hamalert.org',
			to: user.accountEmail,
			subject: 'Your HamAlert account has not been used for 180 days',
			text: `Dear HamAlert user,

Your HamAlert account with the username "${user.username}" has not been used for 180 days.

If you would like to continue using HamAlert to receive spot notifications,
please login again at https://hamalert.org within the next 30 days to show
that you are still using your account. Otherwise your account will be deleted
after 30 days.

vy 73,

The HamAlert team
`
		};
		
		await transporter.sendMail(mail)
		await db.collection('users').updateOne({_id: user._id}, {$set: {loginReminderDate: new Date()}})
	};

	client.close();
});
