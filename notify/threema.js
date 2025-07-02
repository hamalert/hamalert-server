const config = require('../config');
const Notifier = require('./notifier');
const axios = require('axios');
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
			axios.post("https://msgapi.threema.ch/send_e2e", sendParams, {headers: {'Content-Type': 'application/x-www-form-urlencoded'}})
				.then(response => {
					if (response.status != 200) {
						console.error(response.data);
						return;
					}
					console.log(`Sent message ID ${response.data} to Threema ID ${threemaId}`);
				})
				.catch(error => {
					console.error(error);
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
		
		axios.get("https://msgapi.threema.ch/pubkeys/" + threemaId, {params: this.authParams(), responseType: 'text'})
			.then(response => {
				if (response.status != 200) {
					console.error(response);
					callback(null);
					return;
				}
				var publicKey = Buffer.from(response.data, 'hex');
				this.publicKeyCache.set(threemaId, publicKey);
				callback(publicKey);
			})
			.catch(error => {
				console.error(error);
				callback(null);
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
