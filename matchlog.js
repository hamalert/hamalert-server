const exitHook = require('async-exit-hook');
const fs = require('fs');
const config = require('./config');
const ObjectID = require('mongodb').ObjectID;

class MatchLogger {
	constructor(db) {
		this.matchCountPerTriggerId = new Map();
		this.db = db;

		setInterval(() => {
			this._updateDatabase();
		}, config.matchLog.databaseUpdateInterval);
	}
	
	logMatch(trigger) {
		if (!trigger.trigger_ids) {
			return;
		}

		trigger.trigger_ids.forEach(triggerId => {
			let curMatchCount = this.matchCountPerTriggerId.get(triggerId);
			if (curMatchCount === undefined) {
				curMatchCount = 0;
			}
			curMatchCount++;
			this.matchCountPerTriggerId.set(triggerId, curMatchCount);
		});
	}

	_updateDatabase() {
		this.matchCountPerTriggerId.forEach((matchCount, triggerId) => {
			this.db.collection('triggers').updateOne({_id: ObjectID(triggerId)}, {$inc: {matchCount: matchCount}});
		});
		this.matchCountPerTriggerId = new Map();
	}
}

module.exports = MatchLogger;
