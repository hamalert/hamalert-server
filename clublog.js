const request = require('request');
const fs = require('fs');
const config = require('./config');
const LRU = require('lru-cache');
const exitHook = require('async-exit-hook');

class ClubLogResolver {
	constructor(db) {
		this.db = db;
		this.cache = LRU({
			max: config.clublog.cacheSize,
			maxAge: config.clublog.cacheAge
		});
		this.pending = new Map();
		
		if (fs.existsSync(config.clublog.dumpFile)) {
			let cacheSer = fs.readFileSync(config.clublog.dumpFile, {encoding: 'utf8'});
			this.cache.load(JSON.parse(cacheSer));
			console.log(`Read ${this.cache.length} objects into Club Log cache from ${config.clublog.dumpFile}`);
		}
		
		exitHook(() => {
			this.dumpCache();
		});
		
		setInterval(() => {
			let oldItemCount = this.cache.itemCount;
			this.cache.prune();
			console.log(`Club Log: pruned cache (${oldItemCount} -> ${this.cache.itemCount})`);
		}, config.clublog.pruneInterval);
	}
	
	// Perform a Club Log lookup (may be cached) and return the corresponding DXCC from the database
	lookup(callsign, callback) {
		if (config.clublog.noLookupCallsignsRegex.test(callsign)) {
			callback(null);
			return;
		}

		// Strip SSID as it confuses Club Log
		callsign = callsign.replace(/-\d+$/, '');

		// Strip pseudo /SDRx suffix
		callsign = callsign.replace(/\/SDR.$/, '');

		// Check cache
		let cacheDxcc = this.cache.get(callsign);
		if (cacheDxcc !== undefined) {
			//console.log(`Found Club Log entry for ${callsign} in cache`);
			callback(cacheDxcc);
			return;
		}
		
		// Lookup pending?
		let pendingLookup = this.pending.get(callsign);
		if (pendingLookup !== undefined) {
			pendingLookup.push(callback);
			return;
		}
		
		console.log(`Performing Club Log lookup for ${callsign}`);
		pendingLookup = [];
		this.pending.set(callsign, pendingLookup);
		request.get({
			url: 'https://clublog.org/dxcc',
			qs: {
				call: callsign,
				api: config.clublog.apiKey,
				full: 1
			}		
		}, (err, response, body) => {
			
			let doCallback = (result) => {
				this.pending.delete(callsign);
				callback(result);
				pendingLookup.forEach((callback) => callback(result));
			}
			
			if (err !== null) {
				console.error(`Club Log lookup failed: ${err}`);
				return doCallback(null);
			}
		
			if (response.statusCode != 200) {
				console.log(`Club Log lookup returned status code ${response.statusCode}`);
				return doCallback(null);
			}
			
			try {
				let clublogResponse = JSON.parse(body);
				if (!clublogResponse.DXCC) {
					console.error(`No DXCC returned from Club Log for ${callsign}`);
					this.cache.set(callsign, null);
					return doCallback(null);
				}
				this.db.collection('dxccs').findOne({dxcc: clublogResponse.DXCC}, {fields: {_id: 0}}, (err, dxcc) => {
					if (err) {
						console.error(`DXCC DB lookup failed: ${err}`);
						return doCallback(null);
					}
					
					if (!dxcc) {
						console.error(`DXCC ${clublogResponse.DXCC} not found in DB`);
						this.cache.set(callsign, null);
						return doCallback(null);
					}

					// no ITU zone from Club Log?
					if (clublogResponse.CQZ) {
						dxcc.cq = [clublogResponse.CQZ];
					}
					if (clublogResponse.Continent) {
						dxcc.continent = [clublogResponse.Continent];
					}
					
					this.cache.set(callsign, dxcc);
					
					doCallback(dxcc);
				});
			} catch (e) {
				console.error(e);
				return doCallback(null);
			}
		});
	}
	
	dumpCache() {
		let cacheEntries = this.cache.dump();
		fs.writeFileSync(config.clublog.dumpFile, JSON.stringify(cacheEntries), {encoding: 'utf8'});
		console.log(`Dumped Club Log cache (${this.cache.length} entries) to ${config.clublog.dumpFile}`);
	}
}

module.exports = ClubLogResolver;
