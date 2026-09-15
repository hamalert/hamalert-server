const exitHook = require('async-exit-hook');
const fs = require('fs');
const config = require('./config_loader');

// D-STAR identity of a spot, for the per-callsign+band+mode and per-callsign+frequency+mode
// limiters: undefined for non-D-STAR spots, otherwise a key combining the event and reflector
// (or node, if no reflector) so e.g. "linked to REF030-C" doesn't suppress "linked to REF058-E".
function dvKey(spot) {
	if (!spot.dvEvent)
		return undefined;
	// Reflector without its module, matching the dedupe key in dstar.js: the same station may be
	// reported on "REF030-C" by one feed and on plain "REF030" by another
	let place = spot.dvReflector ? spot.dvReflector.split('-')[0] : (spot.dvNode || '');
	return `${spot.dvEvent}|${place}`;
}

class RateLimiter {
	constructor() {
		this.userRateLimiters = new Map();

		if (config.rateLimit.disabled) {
			console.log('Rate limiting is DISABLED (config.rateLimit.disabled)');
		}

		if (fs.existsSync(config.rateLimit.dumpFile)) {
			let dumpArr = JSON.parse(fs.readFileSync(config.rateLimit.dumpFile, {encoding: 'utf8'}));
			for (let dumpEnt of dumpArr) {
				let rateLimiter = new UserRateLimiter(dumpEnt.user_id);
				rateLimiter.restoreCache(dumpEnt.cache);
				this.userRateLimiters.set(dumpEnt.user_id, rateLimiter);
			}
			console.log(`Read ${dumpArr.length} rate limiters from ${config.rateLimit.dumpFile}`);
		}
		
		exitHook(() => {
			this.dumpRateLimiters();
		});
	}
	
	checkLimit(spot, user) {
		if (config.rateLimit.disabled) {
			// local development: never rate-limit alerts, so every matching spot is visible
			return {limitExceeded: false, generalLimitExceeded: false};
		}

		if (spot.user_id) {
			// No rate limits for simulated spots
			return {limitExceeded: false, generalLimitExceeded: false};
		}

		// Do we already have a rate limiter for this user?
		let uid = user._id.toString()
		let rateLimiter = this.userRateLimiters.get(uid);
		if (!rateLimiter) {
			rateLimiter = new UserRateLimiter(uid);
			this.userRateLimiters.set(uid, rateLimiter);
		}
		
		return rateLimiter.checkLimit(spot, user.limit, user.limitPerCallsign, user.limitPerCallsignBandMode, user.limitPerCallsignFreqMode, user.limitSeparateSotaWatch);
	}
	
	dumpRateLimiters() {
		let dumpArr = [];
		this.userRateLimiters.forEach((rateLimiter, user_id, map) => {
			let cache = rateLimiter.dumpCache();
			if (cache === null)
				return;
			dumpArr.push({
				user_id: user_id,
				cache: cache
			});
		});
		fs.writeFileSync(config.rateLimit.dumpFile, JSON.stringify(dumpArr), {encoding: 'utf8'});
		console.log(`Dumped ${dumpArr.length} rate limit entries to ${config.rateLimit.dumpFile}`);
	}
}

class UserRateLimiter {
	constructor(user_id) {
		this.user_id = user_id;	// for debugging purposes
		this.spotCache = [];
	}
	
	checkLimit(spot, limit, limitPerCallsign, limitPerCallsignBandMode, limitPerCallsignFreqMode, limitSeparateSotaWatch) {
		// Go through limit cache and count number of spots per callsign, callsign+band and callsign+freq
		let spots = 0;
		let spotsPerCallsign = 0;
		let spotsPerCallsignBandMode = 0;
		let spotsPerCallsignFreqModeSota = 0;
		let spotsPerCallsignFreqModeOthers = 0;
		let now = Date.now();
		let spotDvKey = dvKey(spot);
		for (let cacheEntry of this.spotCache) {
			if (limit && limit.interval > (now - cacheEntry.time)/1000) {
				spots++;
			}
			
			if (limitPerCallsign && limitPerCallsign.interval > (now - cacheEntry.time)/1000 &&
				cacheEntry.callsign === spot.callsign) {
					spotsPerCallsign++;
			}
			
			if (limitPerCallsignBandMode && limitPerCallsignBandMode.interval > (now - cacheEntry.time)/1000 &&
				cacheEntry.callsign === spot.callsign &&
				cacheEntry.band === spot.band &&
				(cacheEntry.mode === spot.mode || cacheEntry.mode === undefined || spot.mode === undefined) &&
				cacheEntry.dvKey === spotDvKey) {
					spotsPerCallsignBandMode++;
			}
			
			let maxFrequencyDiff = config.rateLimit.maxFrequencyDiff;
			if (config.rateLimit.digiModes.includes(cacheEntry.mode)) {
				maxFrequencyDiff = config.rateLimit.maxFrequencyDiffDigi;
			}
			if (limitPerCallsignFreqMode && limitPerCallsignFreqMode.interval > (now - cacheEntry.time)/1000 &&
				cacheEntry.callsign === spot.callsign &&
				(Math.abs(cacheEntry.frequency - spot.frequency) <= maxFrequencyDiff) &&
				(cacheEntry.mode === spot.mode || cacheEntry.mode === undefined || spot.mode === undefined) &&
				cacheEntry.dvKey === spotDvKey) {

				if (cacheEntry.source === "sotawatch")
					spotsPerCallsignFreqModeSota++;
				else
					spotsPerCallsignFreqModeOthers++;
			}
		}
		
		let spotsPerCallsignFreqMode = 0;
		if (limitSeparateSotaWatch) {
			if (spot.source === "sotawatch") {
				spotsPerCallsignFreqMode = spotsPerCallsignFreqModeSota;
			} else {
				spotsPerCallsignFreqMode = spotsPerCallsignFreqModeOthers;
			}
		} else {
			spotsPerCallsignFreqMode = spotsPerCallsignFreqModeSota + spotsPerCallsignFreqModeOthers;
		}
		
		let limitExceeded = false;
		let generalLimitExceeded = false;
		if (limit && limit.count <= spots) {
			//console.log(`General limit exceeded for user ${this.user_id}`);
			generalLimitExceeded = true;
			limitExceeded = true;
		} else if (limitPerCallsign && limitPerCallsign.count <= spotsPerCallsign) {
			//console.log(`Limit per callsign (${spot.callsign}) exceeded for user ${this.user_id}`);
			limitExceeded = true;
		} else if (limitPerCallsignBandMode && limitPerCallsignBandMode.count <= spotsPerCallsignBandMode) {
			//console.log(`Limit per callsign (${spot.callsign}), band (${spot.band}) and mode (${spot.mode}) exceeded for user ${this.user_id}`);
			limitExceeded = true;
		} else if (limitPerCallsignFreqMode && limitPerCallsignFreqMode.count <= spotsPerCallsignFreqMode) {
			//console.log(`Limit per callsign (${spot.callsign}), frequency (${spot.frequency}) and mode (${spot.mode}) exceeded for user ${this.user_id}`);
			limitExceeded = true;
		}
		
		// clean up old cache entries
		let intervals = [];
		if (limit) {
			intervals.push(limit.interval);
		}
		if (limitPerCallsign) {
			intervals.push(limitPerCallsign.interval);
		}
		if (limitPerCallsignBandMode) {
			intervals.push(limitPerCallsignBandMode.interval);
		}
		if (limitPerCallsignFreqMode) {
			intervals.push(limitPerCallsignFreqMode.interval);
		}
		this.maxInterval = Math.max(...intervals);
		
		this.cleanupCache();
		
		if (!limitExceeded) {
			// Now add this spot to the cache
			this.spotCache.push({
				callsign: spot.callsign,
				band: spot.band,
				frequency: spot.frequency,
				mode: spot.mode,
				time: now,
				source: spot.source,
				dvKey: spotDvKey
			});
		}
		
		return {generalLimitExceeded: generalLimitExceeded, limitExceeded: limitExceeded};
	}
	
	cleanupCache() {
		if (!this.maxInterval)
			return;
		
		let now = Date.now();
		this.spotCache = this.spotCache.filter((cacheEntry) => {
			return ((now - cacheEntry.time)/1000 < this.maxInterval);
		});
	}
	
	dumpCache() {
		this.cleanupCache();
		
		if (this.spotCache.length == 0)
			return null;
		
		return {
			spotCache: this.spotCache,
			maxInterval: this.maxInterval
		};
	}
	
	restoreCache(cache) {
		if (cache === null)
			return;
		
		this.spotCache = cache.spotCache;
		this.maxInterval = cache.maxInterval;
	}
}

module.exports = RateLimiter;
