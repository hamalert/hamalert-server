const {MongoClient} = require('mongodb');
const exitHook = require('async-exit-hook');
const config = require('./config_loader');

class StatsUpdater {
	constructor() {
		this.spots = {};
		this.alerts = {};
		// Last time a spot from each source was processed. Flushed with the counters
		// so tools/spotWatchdog.js can alert when a monitored source goes quiet.
		this.lastSeen = {};
		this.lastDbFlush = new Date();
		
		let client = new MongoClient(config.mongodb.url)
		client.connect().then(() => {
			this.db = client.db(config.mongodb.dbName);
		}).catch((err) => {
			console.error(err);
			process.exit(1);
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
		this.lastSeen[source] = new Date();
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
			let lastSeen = this.lastSeen;

			this.spots = {};
			this.alerts = {};
			this.lastSeen = {};
			this.lastDbFlush = now;
			
			if (Object.keys(inc).length === 0)
				return;

			let writes = [
				this.db.collection('stats').updateOne({date: dmy}, {$inc: inc}, {upsert: true})
			];
			let max = {};
			Object.keys(lastSeen).forEach(key => {
				max[key] = lastSeen[key];
			});
			if (Object.keys(max).length > 0) {
				writes.push(this.db.collection('heartbeat').updateOne({_id: 'spots'}, {$max: max}, {upsert: true}));
			}

			Promise.all(writes).then(() => {
				if (callback)
					callback();
			}).catch((err) => {
				console.error(`Stats update failed: ${err}`);
				if (callback)
					callback(err);
			});
		}
	}
}

module.exports = StatsUpdater;
