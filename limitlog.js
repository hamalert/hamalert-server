const exitHook = require('async-exit-hook');
const fs = require('fs');
const config = require('./config');
const ObjectID = require('mongodb').ObjectID;

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
			this.db.collection('users').updateOne({_id: ObjectID(userId)}, {$inc: {limitExceededCount: exceededCount}});
		});
		this.exceededCountPerUserId = new Map();
	}
}

module.exports = LimitLogger;
