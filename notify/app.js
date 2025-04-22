const config = require('../config');
const Notifier = require('./notifier');
const APNSNotifier = require('./apns');
const FCMNotifier = require('./fcm');

class AppNotifier extends Notifier {
	constructor(db) {
		super();
		this.db = db;
		
		this.notifiers = [
			new APNSNotifier(),
			new FCMNotifier()
		];
		
		this.notifiers.forEach((notifier) => {
			notifier.on('tokenunregistered', (token, user) => {
				this.db.collection('users').updateOne({_id: user._id}, {$pull: {'appTokens': {token: token}}});
			});
		});
	}
	
	notify(user, spot, comment) {
		if (!user.appTokens)
			return;
		
		this.db.collection('users').findOneAndUpdate({_id: user._id}, {$inc: {'badgeCount': 1}},
			{projection: {'badgeCount': 1}, returnOriginal: false}, (err, r) => {
			
			console.log(r);
			if (r && r.value) {
				user.badgeCount = parseInt(r.value.badgeCount);
			} else {
				user.badgeCount = 1;
			}
			
			for (let notifier of this.notifiers) {
				notifier.notify(user, spot, comment);
			}
		});
	}
}

module.exports = AppNotifier;
