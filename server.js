const util = require('util');
const SotaSpotReceiver = require('./sotaspots');
const PotaSpotReceiver = require('./potaspots');
const RbnReceiver = require('./rbn');
const PskReporterReceiver = require('./pskreporter');
const ClusterReceiver = require('./cluster');
const SimulatorReceiver = require('./simulator');
//const EmailNotifier = require('./notify/email');
const ThreemaNotifier = require('./notify/threema');
const URLNotifier = require('./notify/url');
const AppNotifier = require('./notify/app');
const TelnetNotifier = require('./notify/telnetsrv');
const RateLimiter = require('./ratelimit');
const LimitLogger = require('./limitlog');
const MatchLogger = require('./matchlog');
const ClubLogResolver = require('./clublog');
const StatsUpdater = require('./stats');
const ModeGuesser = require('./modeguesser');
const MatcherClient = require('./matcher_client');
const hamutil = require('./hamutil');
const MongoClient = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;
const Redis = require('ioredis');
const assert = require('assert');
const clone = require('clone');
const async = require('async');
const TTLCache = require('@isaacs/ttlcache');
const config = require('./config');

const summitRefRegex = /([a-zA-Z0-9]{1,8}\/[a-zA-Z]{2})\-?((?:[0-9][0-9][1-9])|(?:[0-9][1-9][0])|(?:[1-9][0-9][0]))/;
const sotaRefRegex = /^(.+)\/(.+)\-(\d+)$/;
const wwffRefRegex = /\b([a-z0-9]{1,5})-(\d{4})\b/i;
const iotaRefRegex = /(?:^|\s)(AF|AN|AS|EU|NA|OC|SA)[ -]?(\d{3})\b/i;
const potaLocationStateRegex = /^((US|CA)-..,?)+$/;

var matcherClient = new MatcherClient();

var notifiers;

var rateLimiter = new RateLimiter();
var limitLogger;
var matchLogger;
var statsUpdater = new StatsUpdater();
var modeGuesser = new ModeGuesser();
var db;
var clubLogResolver;

let userCache = new TTLCache({ttl: config.userCache.maxAge});

console.log(`Environment is ${process.env.NODE_ENV}`);

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	db = client.db(config.mongodb.dbName);
	clubLogResolver = new ClubLogResolver(db);
	statsUpdater = new StatsUpdater();
	limitLogger = new LimitLogger(db);
	matchLogger = new MatchLogger(db);
	
	notifiers = {
		/*email: new EmailNotifier('email'),
		email2: new EmailNotifier('email2'),*/
		threema: new ThreemaNotifier(),
		url: new URLNotifier(),
		app: new AppNotifier(db),
		telnet: new TelnetNotifier(db)
	}
	
	startReceivers();
	
	if (config.testOnly) {
		console.log("*** TEST MODE, NO ALERTS WILL BE SENT ***");
	}
});

const redis = new Redis(config.redis.server);


function startReceivers() {
	let spotReceiver = new SotaSpotReceiver(db);
	spotReceiver.on('spot', notifySpot);
	spotReceiver.start();

	let potaSpotReceiver = new PotaSpotReceiver(db);
	potaSpotReceiver.on('spot', notifySpot);
	potaSpotReceiver.start();
	
	config.rbn.forEach(rbnConfig => {
		let rbnReceiver = new RbnReceiver(rbnConfig);
		rbnReceiver.on('spot', notifySpot);
		rbnReceiver.start();
	});
	
	for (let curCluster of config.cluster) {
		let clusterReceiver = new ClusterReceiver(curCluster);
		clusterReceiver.on('spot', notifySpot);
		clusterReceiver.start();
	}
	
	let pskReceiver = new PskReporterReceiver();
	pskReceiver.on('spot', notifySpot);
	pskReceiver.start();
	
	let simulatorReceiver = new SimulatorReceiver(db);
	simulatorReceiver.on('spot', notifySpot);
	simulatorReceiver.start();
	
	/*notifySpot({
		source: "sotawatch",
		fullCallsign: 'HB9DQM/P',
		name: 'Manuel',
		summitRef: 'HB/JU-001',
		mode: "CW",
		frequency: 14.062,
		rawText: "This is a raw spot, push it really good",
		title: "SOTA HB9DQM/P on HB/JU-001 (14.060)"
	});*/
}

function notifySpot(spot) {
	statsUpdater.countSpot(spot.source);
	normalizeSpot(spot, (spot) => {
		console.log(`Spot: ${spot.time} ${spot.fullCallsign} on ${spot.frequency} MHz (${spot.mode}), from ${spot.spotter} via ${spot.source}`);
		
		if (spot.dxcc && spot.dxcc.dxcc == 344 && !spot.user_id) {
			// North Korea, most likely fake
			return;
		}

		runMatcher(spot);
	});
}

function runMatcher(spot) {
	// Find matching triggers using matcher via JSON-RPC
	let conditions = {};
	
	let fields = ['source', 'callsign', 'fullCallsign', 'summitAssociation', 'summitRegion', 'summitPoints', 'summitActivations', 'summitRef', 'wwffRef', 'iotaGroupRef', 'mode', 'time', 'spotter', 'state', 'spotterState', 'qsl', 'prefix', 'spotterPrefix', 'speed', 'snr'];
	for (let field of fields) {
		if (spot[field] !== undefined) {
			conditions[field] = spot[field];
		}
	}
	
	conditions.daysOfWeek = (new Date()).getDay();
	
	if (spot.dxcc) {
		conditions.dxcc = spot.dxcc.dxcc;
		if (spot.dxcc.cq)  conditions.cq = spot.dxcc.cq;
		if (spot.dxcc.itu) conditions.itu = spot.dxcc.itu;
		if (spot.dxcc.continent) conditions.continent = spot.dxcc.continent;
	}
	if (spot.callsignDxcc) {
		conditions.callsignDxcc = spot.callsignDxcc.dxcc;
	}
	if (spot.spotterDxcc) {
		conditions.spotterDxcc = spot.spotterDxcc.dxcc;
		if (spot.spotterDxcc.continent) conditions.spotterContinent = spot.spotterDxcc.continent;
		if (spot.spotterDxcc.cq) conditions.spotterCq = spot.spotterDxcc.cq;
	}
	
	if (spot.wwffDivision) {
		conditions.wwffDivision = [spot.wwffDivision, "*"];
	}
	
	if (spot.iotaGroupRef) {
		conditions.iotaGroupRef = [spot.iotaGroupRef, "*"];
	}
	
	// Add special values 'hf', 'vhf' and 'uhf' to band
	let range;
	if (spot.frequency > 30000) {
		range = 'ehf';
	} else if (spot.frequency > 3000) {
		range = 'shf';
	} else if (spot.frequency > 300) {
		range = 'uhf';
	} else if (spot.frequency > 30) {
		range = 'vhf';
	} else if (spot.frequency > 3) {
		range = 'hf';
	} else if (spot.frequency > 0.3) {
		range = 'mf';
	} else if (spot.frequency > 0.03) {
		range = 'lf';
	} else {
		range = 'vlf';
	}
	conditions.band = [spot.band, range];
	
	// Add band slot condition
	if (spot.dxcc && spot.band) {
		conditions.bandslot = spot.dxcc.dxcc + '_' + spot.band;
	}
	
	if (spot.user_id) {
		// Simulated spot
		conditions.user_id = spot.user_id;
	}
	
	matcherClient.match(conditions, (err, response) => {
		if (err) {
			console.error(`Matcher returned error: ${err}`);
			return;
		}
		
		for (let matcherResult of response) {
			processMatcherResult(matcherResult, spot);
		}
	});
}

function processMatcherResult(result, spot) {
	// Look up user in cache, or in DB if not found
	result.user = userCache.get(result.user_id);
	if (!result.user) {
		db.collection('users').findOne({_id: ObjectID(result.user_id)}, {}, (err, user) => {
			if (user) {
				result.user = user;
				userCache.set(result.user_id, user);
				runNotifiers(result, spot);
			} else {
				console.error(`Could not find user ID ${result.user_id}`);
			}
		});
	} else {
		runNotifiers(result, spot);
	}
}

function runNotifiers(trigger, spot) {
	if (config.testOnly) {
		console.log("Would run notifiers on spot: %j, trigger: %j", spot, trigger);
		return;
	}
	
	// Is this a spot for the user himself?
	if (trigger.user.username == spot.callsign) {
		saveMySpot(spot);
		
		// If only the implicit trigger matched, we can skip the rest
		if (trigger.actions.length == 1 && trigger.actions[0] == "myspot")
			return;
	}

	matchLogger.logMatch(trigger);
	
	if (trigger.user.alerts) {			
		let limitRes = rateLimiter.checkLimit(spot, trigger.user);
	    if (limitRes.limitExceeded) {
	   		// Rate limit exceeded - record this fact in DB if the general limit was exceeded
			if (limitRes.generalLimitExceeded) {
				limitLogger.logLimitExceeded(trigger.user);
			}
	   	} else {
			// Rate limit OK
			saveSpot(trigger, spot);
			
			// Check mutes
			db.collection('mutes').findOne({"user_id": trigger.user._id, "expires": {"$gte": new Date()}, "callsign": spot.callsign,
				"$and": [
					{"$or": [{"band": spot.band}, {"band": null}]},
					{"$or": [{"mode": spot.mode}, {"mode": null}]},
					{"$or": [{"summitRef": spot.summitRef}, {"summitRef": null}]}
				]}, {}, (err, mute) => {
			
				if (mute)
					return;
				for (let action of trigger.actions) {
					let notifier = notifiers[action];
					if (notifier) {
						statsUpdater.countAlert(action);
						notifier.notify(trigger.user, spot, trigger.comment);
					} else {
						console.log("No notifier for '" + action + "'");
					}
				}
			});
		}
	}
}

function saveSpot(trigger, spot) {
	// Write in MongoDB
	let dbSpot = clone(spot);
	dbSpot.user_id = trigger.user._id;
	dbSpot.actions = trigger.actions;
	dbSpot.triggerComments = trigger.comment;
	db.collection('spots').insertOne(dbSpot);

	// Publish in Redis Stream
	let redisSpot = hamutil.makeSpotParams(spot, trigger.comment, trigger.actions);
	let args = [];
	for (let key in redisSpot) {
		if (redisSpot.hasOwnProperty(key) && redisSpot[key] != null) {
			args.push(key, String(redisSpot[key]));
		}
	}
	redis.xadd('spots:' + trigger.user._id.toString(), 'MINID', new Date().getTime() - config.redis.spotMaxAge, '*', args);
}

function saveMySpot(spot) {
	db.collection('myspots').replaceOne({callsign: spot.callsign}, spot, {upsert: true});
}

function normalizeSpot(spot, callback) {
	// insert reception date
	spot.receivedDate = new Date();
	
	// lowercase mode
	if (spot.mode) {
		spot.mode = spot.mode.toLowerCase();
		spot.modeDetail = spot.mode;
		// treat all PSK the same
		if (spot.mode.startsWith('psk')) {
			spot.mode = 'psk';
		}
		// treat all JT the same
		if (spot.mode.startsWith('jt')) {
			spot.mode = 'jt';
		}
		// treat all MSK the same
		if (spot.mode.startsWith('msk')) {
			spot.mode = 'msk';
		}
	} else {
		// guess mode, if necessary
		let guessedMode = modeGuesser.guessMode(spot);
		if (guessedMode) {
			spot.mode = guessedMode;
			spot.modeDetail = guessedMode;
			spot.modeIsGuessed = true;
			console.log(`Guessed mode for spot "${spot.rawText}": ${guessedMode}`);
		}
	}
	
	// strip invalid characters from callsign
	spot.fullCallsign = spot.fullCallsign.replace(/[^0-9A-Z\/]/g, '');
	
	// extract canonical callsign (without prefix/suffix)
	spot.callsign = hamutil.extractCanonicalCallsign(spot.fullCallsign);

	// determine prefix
	let prefix = calcPrefix(spot.fullCallsign);
	if (prefix) {
		spot.prefix = prefix;
	}

	// determine spotter prefix
	if (spot.spotter) {
		let spotterPrefix = calcPrefix(spot.spotter);
		if (spotterPrefix) {
			spot.spotterPrefix = spotterPrefix;
		}
	}
	
	// determine band
	let band = config.bands.find((element) => {
		return (element.from <= spot.frequency && element.to >= spot.frequency)
	});
	if (band !== undefined)
		spot.band = band.band;
	
	// parse summit reference
	if (spot.summitRef) {
		let matches = sotaRefRegex.exec(spot.summitRef);
		if (matches) {
			spot.summitAssociation = matches[1];
			spot.summitRegion = matches[2];
		}
	}
	
	// Asynchronous tasks
	async.parallel([
		// Lookup full callsign and bare callsign (if different)
		(callback) => {
			clubLogResolver.lookup(spot.fullCallsign, (dxcc) => {
				spot.dxcc = dxcc;
		
				if ((spot.fullCallsign === spot.callsign) || (spot.fullCallsign === (spot.callsign + '/P'))) {
					spot.callsignDxcc = spot.dxcc;
					callback();
				} else {
					clubLogResolver.lookup(spot.callsign, (callsignDxcc) => {
						spot.callsignDxcc = callsignDxcc;
						callback();
					});
				}
			});
		},
		
		// Find spotter DXCC
		(callback) => {
			if (spot.spotter) {
				clubLogResolver.lookup(spot.spotter, (spotterDxcc) => {
					if (spotterDxcc)
						spot.spotterDxcc = spotterDxcc;
					callback();
				});
			} else {
				callback();
			}
		},
		
		// Find SOTA ref
		(callback) => {
			findSotaRef(spot, callback);
		}, 
		
		// Find WWFF ref
		(callback) => {
			findWwffRef(spot, callback);
		}, 
		
		// Find IOTA ref
		(callback) => {
			findIotaGroupRef(spot, callback);
		},

		// Find callsign info
		(callback) => {
			findCallsignInfo(spot, callback);
		}
	], () => {
		callback(spot);
	});
}

function findSotaRef(spot, callback) {
	// Find a SOTA reference in the spot comment, and populate the SOTA fields if 
	// a valid reference has been found
	if (spot.summitRef) {
		// Already have a SOTA reference
		callback();
		return;
	}
	
	let matches = summitRefRegex.exec(spot.rawText);
	if (matches) {
		// Look up summit ref in database to be sure
		let summitRef = matches[1].toUpperCase() + '-' + matches[2];
		db.collection('summits').findOne({SummitCode: summitRef}, {}, (err, summit) => {			
			if (summit) {
				spot.summitRef = summitRef;
				spot.summitName = summit.SummitName;
				spot.summitHeight = parseInt(summit.AltM);
				spot.summitPoints = parseInt(summit.Points);
				spot.summitActivations = parseInt(summit.ActivationCount);
			} else {
				console.info(`Summit ${summitRef} not found in database`);
			}
	
			callback();
		});
	} else {
		callback();
	}
}

function findWwffRef(spot, callback) {
	// Find a WWFF reference in the spot comment, and populate the wwff fields if 
	// a valid reference has been found
	if (spot.wwffRef) {
		// Already have a WWFF reference
		callback();
		return;
	}
	
	let stringToSearch = spot.comment;
	if (spot.wwffRefRaw) {
		stringToSearch = spot.wwffRefRaw;
		delete spot.wwffRefRaw;
	}
	let matches = wwffRefRegex.exec(stringToSearch);
	if (matches) {
		let wwffDivision = matches[1].toUpperCase();
		let wwffNum = matches[2];
		let wwffRef = wwffDivision + "-" + wwffNum;
		
		// Check for active reference in database
		db.collection('wwffParks').findOne({reference: wwffRef, status: 'active'}, {}, (err, park) => {
			if (park) {
				spot.wwffDivision = wwffDivision;
				spot.wwffRef = wwffRef;
				spot.wwffName = park.name;
				spot.wwffProgram = park.program;

				// POTA: use US state from POTA park reference (override callsign home state)
				if (potaLocationStateRegex.test(park.location)) {
					spot.state = park.location.split(',').map(str => str.replace('-', '_'));
				}
			} else {
				console.info(`WWFF reference ${wwffRef} not found in database`);
			}
			
			callback();
		});
	} else {
		callback();
	}
}

function findIotaGroupRef(spot, callback) {
	// Find a IOTA group reference in the spot comment, and populate the iota fields if 
	// a valid reference has been found
	if (spot.iotaGroupRef) {
		// Already have a IOTA reference
		callback();
		return;
	}
	
	let matches = iotaRefRegex.exec(spot.comment);
	if (matches) {
		let iotaContinent = matches[1].toUpperCase();
		let iotaNum = matches[2];
		let iotaGroupRef = iotaContinent + "-" + iotaNum;
		
		// Check for active reference in database
		db.collection('iotaGroups').findOne({grpRef: iotaGroupRef}, {}, (err, iotaGroup) => {
			if (iotaGroup) {
				spot.iotaGroupRef = iotaGroup.grpRef;
				spot.iotaGroupName = iotaGroup.grpName;
			} else {
				console.info(`IOTA group reference ${iotaGroupRef} not found in database`);
			}
			
			callback();
		});
	} else {
		callback();
	}
}

function findCallsignInfo(spot, callback) {
	db.collection('callsignInfo').findOne({callsign: spot.fullCallsign}, {}, (err, callsignInfo) => {
		if (callsignInfo) {
			if (callsignInfo.state && !spot.state) {
				spot.state = callsignInfo.state;
			}
			if (callsignInfo.eqsl || callsignInfo.lotw) {
				spot.qsl = [];
				if (callsignInfo.eqsl)
					spot.qsl.push('eqsl');
				if (callsignInfo.lotw)
					spot.qsl.push('lotw');
			}
		}

		if (spot.spotter) {
			// Strip some common non-location-modifying suffixes for callsign lookup
			let cleanSpotterCallsign = spot.spotter.replace(/\/(QRP|SDR)$/i, '');

			db.collection('callsignInfo').findOne({callsign: cleanSpotterCallsign}, {}, (err, spotterCallsignInfo) => {
				if (spotterCallsignInfo && spotterCallsignInfo.state) {
					spot.spotterState = spotterCallsignInfo.state;
				}
				callback();
			});
		} else {
			callback();
		}
	});
}

function calcPrefix(callsign) {
	let prefixRegex = /^([0-9]*[A-Z]+[0-9]*)/;
	let matches = prefixRegex.exec(callsign.trim().toUpperCase());
	if (matches) {
		return matches[1];
	}

	return null;
}
