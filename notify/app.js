const config = require('../config_loader');
const Notifier = require('./notifier');
const APNSNotifier = require('./apns');
const FCMNotifier = require('./fcm');

class AppNotifier extends Notifier {
	constructor(db) {
		super();
		this.db = db;
		
		this.notifiers = [];
		if (config.apns) {
			this.notifiers.push(new APNSNotifier());
		}
		if (config.fcm) {
			this.notifiers.push(new FCMNotifier());
		}
		
		this.notifiers.forEach((notifier) => {
			notifier.on('tokenunregistered', (token, user) => {
				this.db.collection('users').updateOne({_id: user._id}, {$pull: {'appTokens': {token: token}}}).catch((err) => console.error(err));
			});
		});
	}
	
	notify(user, spot, comment) {
		if (!user.appTokens)
			return;
		
		const send = (r) => {
			const updatedCount = r ? parseInt(r.badgeCount, 10) : NaN;
			if (!isNaN(updatedCount)) {
				user.badgeCount = updatedCount;
			} else {
				user.badgeCount = 1;
			}

			for (let notifier of this.notifiers) {
				notifier.notify(user, spot, comment);
			}
		};

		this.db.collection('users').findOneAndUpdate({_id: user._id}, {$inc: {'badgeCount': 1}},
			{projection: {'badgeCount': 1}, returnDocument: 'after'}).then(send).catch((err) => {
			console.error(err);
			send(null);
		});
	}
}

module.exports = AppNotifier;
