const firebaseAdmin = require('firebase-admin');
const config = require('../config');
const Notifier = require('./notifier');
const expand = require('expand-template')();
const hamutil = require('../hamutil');
const util = require('util');
const clone = require('clone');

class FCMNotifier extends Notifier {
	constructor() {
		super();

		const app = firebaseAdmin.initializeApp({
		  credential: firebaseAdmin.credential.cert(config.fcm.serviceAccount),
		  databaseURL: config.fcm.databaseUrl
		});

		this.messaging = app.messaging();
	}
	
	notify(user, spot, comment) {
		if (!user.appTokens) {
			return;
		}
		
		let msgTemplate = {
			data: {
				title: spot.title,
				body: spot.rawText,
				sound: 'default',
				icon: 'notification',
				hamalert: JSON.stringify({callsign: spot.callsign, band: spot.band}),
				notId: Math.round((new Date()).getTime() / 1000).toString(),
				actions: JSON.stringify([
					{'title': 'Mute Callsign', 'callback': 'pushmute', 'foreground': true},
					{'title': 'Mute Callsign + Band', 'callback': 'pushmuteband', 'foreground': true}
				])
			},
			android: {
				priority: 'high',
				ttl: 3600000
			}
		};

		if (user.app) {
			let placeholders = hamutil.makeSpotParams(spot, comment);
			if (user.app.titleFormat) {
				msgTemplate.data.title = expand(user.app.titleFormat, placeholders);
			}
			if (user.app.bodyFormat) {
				msgTemplate.data.body = expand(user.app.bodyFormat, placeholders);
			}
		}
		
		// Must create a separate message for each token as the sounds could be different
		let messages = [];
		for (let appToken of user.appTokens) {
			if (appToken.type !== 'gcm' || appToken.disable) {
				continue;
			}
			
			let msg = clone(msgTemplate);
			msg.data.sound = 'default';
			if (appToken.sound == 'morse') {
				if (spot.summitRef) {
					msg.data.sound = 'sota';
				} else if (spot.wwffRef) {
					msg.data.sound = 'wwff';
				} else if (spot.iotaGroupRef) {
					msg.data.sound = 'iota';
				} else if (spot.source == 'sotawatch') {
					msg.data.sound = 'sota';
				} else if (spot.source == 'rbn') {
					msg.data.sound = 'rbn';
				} else if (spot.source == 'cluster' || spot.source == 'pskreporter') {
					msg.data.sound = 'dx';
				}
			} else if (appToken.sound == 'blip') {
				msg.data.sound = 'blip';
			}
			msg.data.android_channel_id = msg.data.sound;
			msg.token = appToken.token;
			messages.push(msg);
		}

		if (messages.length === 0) {
			return;
		}

		this.messaging.sendEach(messages)
			.then(response => {
				console.log(`FCM response: ${util.inspect(response, {depth: null})}`);
				
				// Check for NotRegistered errors (e.g. when users uninstall app)
				for (let i = 0; i < response.responses.length; i++) {
					if (!response.responses[i].success && response.responses[i].error.errorInfo.code === 'messaging/registration-token-not-registered') {
						console.log(`FCM token ${user.appTokens[i].token} is not registered anymore`);
						this.emit('tokenunregistered', user.appTokens[i].token, user);
					}
				}
			})
			.catch(error => {
				console.error(error);
			});
	}
}

module.exports = FCMNotifier;
