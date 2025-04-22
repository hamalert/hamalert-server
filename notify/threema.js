const config = require('../config');
const Notifier = require('./notifier');
const request = require('request');
const nacl = require('tweetnacl/nacl-fast');

var threemaIdRegex = /^[A-Z0-9]{8}$/;

class ThreemaNotifier extends Notifier {
	constructor() {
		super();
		this.publicKeyCache = new Map();
	}
	
	notify(user, spot) {
		if (!user.threemaId)
			return;
		
		var text = "*" + spot.title + "*\n" + spot.rawText;
		this.sendThreemaMessage(user.threemaId, text);
	}
	
	sendThreemaMessage(threemaId, text) {
		this.fetchPublicKey(threemaId, (publicKey) => {
			if (!publicKey)
				return;
			
			var typeByte = Buffer.from('01', 'hex');
			var msgBuf = Buffer.from(text);
			var padding = Buffer.from('01', 'hex');
			var msg = Buffer.concat([typeByte, msgBuf, padding]);
			
			var nonce = nacl.randomBytes(nacl.box.nonceLength);
			
			var box = nacl.box(msg, nonce, publicKey, config.threema.privateKey);
			
			var sendParams = this.authParams();
			sendParams.to = threemaId;
			sendParams.nonce = Buffer.from(nonce).toString('hex');
			sendParams.box = Buffer.from(box).toString('hex');
			request.post({
				url: "https://msgapi.threema.ch/send_e2e",
				form: sendParams
			}, (error, response, body) => {
				if (error) {
					console.error(error);
					return;
				}
				if (response.statusCode != 200) {
					console.error(body);
					return;
				}
				
				console.log(`Sent message ID ${body} to Threema ID ${threemaId}`);
			});
		});
	}
	
	
	fetchPublicKey(threemaId, callback) {
		if (!threemaIdRegex.test(threemaId)) {
			callback(null);
			return;
		}
		
		var publicKey = this.publicKeyCache.get(threemaId);
		if (publicKey) {
			callback(publicKey);
			return;
		}
		
		request.get({
			url: "https://msgapi.threema.ch/pubkeys/" + threemaId,
			qs: this.authParams()
		}, (error, response, body) => {
			if (error) {
				console.error(error);
				callback(null);
				return;
			}
			if (response.statusCode != 200) {
				console.error(response);
				callback(null);
				return;
			}
			
			var publicKey = Buffer.from(body, 'hex');
			this.publicKeyCache.set(threemaId, publicKey);
			callback(publicKey);
		});
	}
	
	authParams() {
		return {
			from: config.threema.apiId,
			secret: config.threema.apiSecret
		};
	}
}

module.exports = ThreemaNotifier;
