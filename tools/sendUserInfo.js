const MongoClient = require('mongodb').MongoClient;
const nodemailer = require('nodemailer');
const assert = require('assert');
const config = require('../config');
const async = require('async');

let client = MongoClient.connect(config.mongodb.url, async function (err, db) {
	assert.equal(null, err);
	
	let transporter = nodemailer.createTransport(config.mail.transport);

	let maxDate = new Date(Date.now() - config.accountPruning.reminderInterval);
	let users = await db.collection('users').find({emailInfoSent: null}).toArray();
	let emailTasks = users.map(user => {
		return function(callback) {
			let mail = {
				from: 'do-not-reply@hamalert.org',
				to: user.accountEmail,
				subject: 'HamAlert: Email notifications will be discontinued on September 19',
				text: `Dear HamAlert user,

This message is to inform you that from September 19, HamAlert email notifications for spots will be discontinued. The reason is that HamAlert is switching to a new server infrastructure, which makes sending large amounts of email more difficult than it already is.

HamAlert sends about one million emails per month, and nowadays it's a challenge to get such a volume to actually reach user's inboxes without being stopped by spam filters and rate limits. It's always been an issue – for example, Yahoo users have rarely received their email notifications from HamAlert on time, and some email providers have outright blocked them. Many times I have had to manually contact major mailbox hosting providers to beg them to adjust their filters and limits. But realistically, emails are not really suitable for real-time information such as amateur radio spots anyway, as they may take several minutes to be delivered (greylisting, client polling intervals etc.).

The preferred way to receive HamAlert notifications is to install the free HamAlert app on your smartphone. If you prefer an integration with the logging or cluster monitoring software on your computer, the Telnet interface may be useful (but a bit more tricky to set up and less reliable due to the lack of standardization of Telnet for transporting spots). Advanced users with coding experience can fashion their own integrations using the URL (webhook) destination.

Email will continue to be used for basic communication about your account (e.g. important news like this one, password resets etc.). A transactional email provider will be used for this purpose to ensure reliable delivery.

Thank you for your understanding.

73,

Manuel HB9DQM
`
			};

			console.log(user.accountEmail);
			
			transporter.sendMail(mail, function (err, info) {
				if (err) {
					console.error(err);
					callback(err);
				} else {
					db.collection('users').updateOne({_id: user._id}, {$set: {emailInfoSent: true}}, (err, r) => {
						assert.equal(null, err);
						callback(null, callback);
					});
				}
			});
		}
	})

	async.series(emailTasks, () => {
		db.close();
	});	

	/*(async (err, user) => {
		assert.equal(null, err);
		if (!user) {
			db.close();
			return;
		}

		

		await new Promise(resolve => setTimeout(resolve, 100));
	});*/
});
