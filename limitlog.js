const exitHook = require('async-exit-hook');
const fs = require('fs');
const config = require('./config_loader');
const {ObjectId} = require('mongodb');

class LimitLogger {
	constructor(db) {
		this.exceededCountPerUserId = new Map();
		this.db = db;

		setInterval(() => {
			this._updateDatabase();
		}, config.limitLog.databaseUpdateInterval);
	}
	
	logLimitExceeded(user) {
		let userIdHex = user._id.toHexString();
		let curExceededCount = this.exceededCountPerUserId.get(userIdHex);
		if (curExceededCount === undefined) {
			curExceededCount = 0;
		}

		curExceededCount++;
		this.exceededCountPerUserId.set(userIdHex, curExceededCount);
	}

	_updateDatabase() {
		this.exceededCountPerUserId.forEach((exceededCount, userId) => {
			this.db.collection('users').updateOne({_id: new ObjectId(userId)}, {$inc: {limitExceededCount: exceededCount}}).catch((err) => console.error(err));
		});
		this.exceededCountPerUserId = new Map();
	}
}

module.exports = LimitLogger;
