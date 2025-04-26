const apn = require('@parse/node-apn');
const config = require('../config');
const Notifier = require('./notifier');
const expand = require('expand-template')();
const hamutil = require('../hamutil');
const util = require('util');

class APNSNotifier extends Notifier {
	constructor() {
		super();
		this.apn = new apn.Provider(config.apns);
		this.lastReconnect = new Date();
	}
	
	notify(user, spot, comment) {
		if (!user.appTokens)
			return;
		
		// Workaround for keepalive/InternalServerError bug: reconnect if last
		// reconnection is more than 10 minutes ago
		let now = new Date();
		if ((now - this.lastReconnect) > 600000) {
			console.log("APNS: reconnecting");
			this.apn.shutdown();
			this.apn = new apn.Provider(config.apns);
			this.lastReconnect = new Date();
		}
		
		for (let appToken of user.appTokens) {
			if (appToken.type !== 'apns' || appToken.disable)
				continue;
			
			let note = new apn.Notification();
			note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
			note.badge = user.badgeCount;
			note.sound = "default";
			note.title = spot.title;
			note.body = spot.rawText;
			note.topic = 'org.hamalert.app';
			note.category = 'spot';
			note.payload.hamalert = {callsign: spot.callsign, band: spot.band};
			note.payload.notId = Math.round((new Date()).getTime() / 1000);

			if (user.app) {
				let placeholders = hamutil.makeSpotParams(spot, comment);
				if (user.app.titleFormat) {
					note.title = expand(user.app.titleFormat, placeholders);
				}
				if (user.app.bodyFormat) {
					note.body = expand(user.app.bodyFormat, placeholders);
				}
			}
			if (appToken.sound == 'morse') {
				if (spot.summitRef) {
					note.sound = 'sota.caf';
				} else if (spot.wwffRef) {
					note.sound = 'wwff.caf';
				} else if (spot.iotaGroupRef) {
					note.sound = 'iota.caf';
				} else if (spot.source == 'sotawatch') {
					note.sound = 'sota.caf';
				} else if (spot.source == 'rbn') {
					note.sound = 'rbn.caf';
				} else if (spot.source == 'cluster' || spot.source == 'pskreporter') {
					note.sound = 'dx.caf';
				}
			} else if (appToken.sound == 'blip') {
				note.sound = 'blip.caf';
			}
			
			this.apn.send(note, appToken.token).then((result) => {
				console.log(`APNS result: ${util.inspect(result, {depth: null})}`);
				
				if (result.failed) {
					for (let failed of result.failed) {
						if (failed.response && failed.response.reason === 'Unregistered') {
							console.log(`APNS token ${failed.device} is not registered anymore`);
							this.emit('tokenunregistered', failed.device, user);
						}
					}
				}
			});
		}
	}
}

module.exports = APNSNotifier;
