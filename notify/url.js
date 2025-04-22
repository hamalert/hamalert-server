const config = require('../config');
const Notifier = require('./notifier');
const request = require('request');
const hamutil = require('../hamutil');

/* URL parameters (GET or POST):

	- fullCallsign (with prefix/suffix)
	- callsign (without prefix/suffix)
	- frequency (MHz)
	- band ('20m', '40m', '70cm' etc.)
	- mode ('cw', 'ssb', 'fm', 'dv', 'am', 'psk', 'rtty')
	- time (HH:MM)
	- dxcc (DXCC number, multiple separated by ,)
	- homeDxcc
	- spotterDxcc
	- cq (zone number, multiple separated by ,)
	- continent ('EU', 'AF', 'AS', 'NA', 'SA', 'OC', 'AN' - multiple separated by ,)
	- spotter
	- rawText (raw spot text)
	- title (spot title, e.g. "RBN spot EX4MPL (3.505 CW)")
	- summitName (SOTA summit name)
	- summitHeight (SOTA summit height in m)
	- summitPoints (SOTA summit points)
	- summitRef (SOTA summit reference)
	- source ('rbn', 'sotawatch', 'cluster')
	- comment (trigger comment, multiple separated by ,)
*/

class URLNotifier extends Notifier {
	
	notify(user, spot, comment) {
		if (!user.notificationUrl || !user.notificationMethod)
			return;
		
		let params = hamutil.makeSpotParams(spot, comment);
		
		this.sendURLNotification(user, params);
	}
	
	sendURLNotification(user, params) {
		let options = {
			url: user.notificationUrl,
			method: (user.notificationMethod === 'POST-JSON' ? 'POST' : user.notificationMethod)
		};
		
		if (user.notificationMethod === 'GET') {
			options.qs = params;
		} else if (user.notificationMethod === 'POST') {
			options.form = params;
		} else if (user.notificationMethod === 'POST-JSON') {
			options.json = params;
		} else {
			console.error(`Unknown URL notification method ${user.notificationMethod}`);
		}
		
		request(options, (error, response, body) => {
			if (error) {
				console.error(`Notification to URL ${user.notificationUrl} failed: ${error}`);
			}
		});
	}
}

module.exports = URLNotifier;
