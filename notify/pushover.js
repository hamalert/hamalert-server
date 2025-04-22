const push = require('pushover-notifications');
const config = require('../config');
const Notifier = require('./notifier');

class PushoverNotifier extends Notifier {
	constructor() {
		super();
		this.p = new push( {
			token: config.pushover.token,
			onerror: (err) => {
				console.error(err);
			}
		});
	}
	
	notify(user, spot) {
		if (!user.pushoverUserKey)
			return;
		
		var msg = {
			title: spot.title,
			message: spot.rawText,
			sound: 'intermission',
			user: user.pushoverUserKey
		};
	
		this.p.send(msg, (err, result) => {
			if (err) {
				console.error(err);
			}
		});
	}
}

module.exports = PushoverNotifier;
