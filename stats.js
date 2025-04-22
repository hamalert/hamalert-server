const MongoClient = require('mongodb').MongoClient;
const exitHook = require('async-exit-hook');
const config = require('./config');
const assert = require('assert');

class StatsUpdater {
	constructor() {
		this.spots = {};
		this.alerts = {};
		this.lastDbFlush = new Date();
		
		let client = new MongoClient(config.mongodb.url)
		client.connect((err) => {
			assert.equal(null, err);
			this.db = client.db(config.mongodb.dbName);
		});
		
		exitHook((callback) => {
			this.flushToDb(true, callback);
		});
	}
	
	countSpot(source) {
		if (this.spots[source])
			this.spots[source]++;
		else
			this.spots[source] = 1;
		this.flushToDb(false);
	}
	
	countAlert(action) {
		if (this.alerts[action])
			this.alerts[action]++;
		else
			this.alerts[action] = 1;
		this.flushToDb(false);
	}
	
	flushToDb(force, callback) {
		if (!this.db)
			return;	// DB not ready yet
		
		let now = new Date();
		let dmy = now.toISOString().slice(0, 10);
		if ((now - this.lastDbFlush) >= config.stats.flushInterval || force) {
			let inc = {};
			Object.keys(this.spots).forEach(key => {
				inc['spots.' + key] = this.spots[key];
			});
			Object.keys(this.alerts).forEach(key => {
				inc['alerts.' + key] = this.alerts[key];
			});
			
			this.spots = {};
			this.alerts = {};
			this.lastDbFlush = now;
			
			if (Object.keys(inc).length === 0)
				return;
			
			this.db.collection('stats').updateOne({date: dmy}, {$inc: inc}, {upsert: true}, (err, result) => {
				if (err)
					console.error(`Stats update failed: ${err}`);
				
				if (callback)
					callback(err);
			});
		}
	}
}

module.exports = StatsUpdater;
