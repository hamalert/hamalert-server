const jayson = require('jayson');
const config = require('./config');
const assert = require('assert');
const MongoClient = require('mongodb').MongoClient;
const RoaringBitmap32 = require("roaring/RoaringBitmap32");
const async = require('async');

// A object of Maps for each common condition type encountered in triggers
let conditionMaps;

// An array of trigger objects, where the index equals the values referenced
// in condition map arrays
let triggers;

// An array of trigger objects that don't have any common conditions
let triggersWithoutCommonConditions;

// Sanity check on common conditions
if (config.matcher.commonConditions.some(condition => condition.startsWith('not'))) {
	console.error("commonConditions may not contain 'not' conditions!");
	process.exit(1);
}

// A set of conditions that are not very common (and thus are not optimized by hash tables)
let uncommonConditions = new Set(config.matcher.conditions);
config.matcher.commonConditions.forEach(condition => {
	uncommonConditions.delete(condition);
});

let db;
let reloading = false;
let reloadCallbackQueue = [];
let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	db = client.db(config.mongodb.dbName);
	
	reloadTriggers(numTriggers => {
		startServer();
		setInterval(reloadTriggers, config.matcher.reloadInterval);
	});
});

function startServer() {
	// Listen for IPC messages from parent
	process.on('message', (data) => {
		try {
			let matches = doMatch(data.query);
			process.send({id: data.id, matches: matches});
		} catch (e) {
			console.error(e);
			process.send({id: data.id, error: e.message});
		}
	});
	
	// Start JSON-RPC server as well
	/*let server = jayson.server({
		match: (args, callback) => {
			try {
				let matches = doMatch(args[0]);
				callback(null, matches);
			} catch (e) {
				console.error(e);
				callback(e);
			}
		},
		reload: (args, callback) => {
			console.log("Reload requested via JSON-RPC");
			reloadTriggers(count => {
				callback(null, {count: count});
			});
		},
		reloadAsync: (args, callback) => {
			console.log("Reload requested via JSON-RPC");
			reloadTriggers();
			callback(null, {});
		}
	});
	
	server.http().listen(config.matcher.port, config.matcher.address);*/
}

function doMatch(query) {
	let start_time = process.hrtime.bigint();

	// Find triggers matching common conditions and get the appropriate bitmaps of trigger numbers
	let intersectedBitmap = undefined;
	
	for (let condition of config.matcher.commonConditions) {
		let conditionMap = conditionMaps[condition];
		let unionBitmaps = [];
	
		let queryCondition = condition;

		// Always add the 'null' entry for those triggers that don't have this particular condition
		unionBitmaps.push(conditionMap.get(null));
		
		// Get all arrays for this condition and the values provided in the query
		// (there may be multiple, in which case we need to calculate the union)
		let queryValues = query[queryCondition];
		if (queryValues !== undefined) {			
			if (!Array.isArray(queryValues)) {
				queryValues = [queryValues];
			}
		
			for (let queryValue of queryValues) {
				// Find a match for this query condition value
				let matchBitmap = conditionMap.get(queryValue);
				if (matchBitmap !== undefined) {
					unionBitmaps.push(matchBitmap);
				}
			}
		}
		
		// Calculate union of the bitmaps, and intersect
		let unionBitmap = RoaringBitmap32.orMany(unionBitmaps);
		if (intersectedBitmap === undefined) {
			intersectedBitmap = unionBitmap;
		} else {
			intersectedBitmap.andInPlace(unionBitmap);
		}
	}
		
	// Make map of matching triggers, grouped by user, with actions/comments aggregated
	let matchingTriggerUsers = new Map();
	for (const triggerNumber of intersectedBitmap) {
		postCheckTrigger(triggers[triggerNumber], query);
	}

	// Append triggers without common conditions
	triggersWithoutCommonConditions.forEach(postCheckTrigger, query);

	function postCheckTrigger(trigger, query) {		
		// Check "uncommon" conditions only at this point, as the triggers not matching common conditions
		// will already have been weeded out by the hash table step above
		let match = true;
		for (let condition in trigger.conditions) {
			if (!uncommonConditions.has(condition)) {
				continue;
			}

			let queryCondition = condition;	
			if (condition.startsWith('not')) {
				queryCondition = condition.charAt(3).toLowerCase() + condition.substring(4);
			}
			let queryValues = query[queryCondition];
			if (queryValues === undefined) {
				match = false;
				break;
			}

			if (!Array.isArray(queryValues)) {
				queryValues = [queryValues];
			}
			
			if (condition.startsWith('not')) {
				// Negative condition – if we find any query value in the condition values, we have a mismatch
				for (let queryValue of queryValues) {
					if (trigger.conditions[condition].has(queryValue)) {
						match = false;
						break;
					}
				}
			} else {
				// Positive condition – if we find any query value in the condition values, we have a match
				let qMatch = false;
				for (let queryValue of queryValues) {
					if (trigger.conditions[condition].has(queryValue)) {
						qMatch = true;
						break;
					}
				}

				if (!qMatch) {
					match = false;
					break;
				}
			}
		}
		if (!match) {
			return;
		}

		// Check time
		if (query.time && trigger.conditions.timeFrom && trigger.conditions.timeTo) {
			if (trigger.conditions.timeFrom <= trigger.conditions.timeTo) {
				if (trigger.conditions.timeFrom > query.time || trigger.conditions.timeTo < query.time)
					return;
			} else {
				// Spans midnight
				if (trigger.conditions.timeFrom > query.time && trigger.conditions.timeTo < query.time)
					return;
			}
		}

		// Check speed (CW WPM from RBN)
		if (trigger.conditions.speedFrom && trigger.conditions.speedTo) {
			if (!query.speed || trigger.conditions.speedFrom > query.speed || trigger.conditions.speedTo < query.speed)
				return;
		}

		// Check SNR (dB from RBN or PSK Reporter)
		if (trigger.conditions.snrFrom && trigger.conditions.snrTo) {
			if (!query.snr || trigger.conditions.snrFrom > query.snr || trigger.conditions.snrTo < query.snr)
				return;
		}

		// Check summit points (SOTA)
		if (trigger.conditions.summitPointsFrom && trigger.conditions.summitPointsTo) {
			if (!query.summitPoints || trigger.conditions.summitPointsFrom > query.summitPoints || trigger.conditions.summitPointsTo < query.summitPoints) {
				return;
			}
		}

		// Check activation counts (SOTA)
		if (trigger.conditions.summitActivationsFrom !== undefined && trigger.conditions.summitActivationsTo !== undefined) {
			if (query.summitActivations === undefined || trigger.conditions.summitActivationsFrom > query.summitActivations || trigger.conditions.summitActivationsTo < query.summitActivations) {
				return;
			}
		}
		
		// Check user ID (for simulated spots)
		if (query.user_id) {
			if (query.user_id != trigger.user_id)
				return;
		}
		
		let triggerUser = matchingTriggerUsers.get(trigger.user_id.toString());
		if (!triggerUser) {
			triggerUser = {};
			triggerUser.user_id = trigger.user_id.toString();
			triggerUser.actions = new Set();
			triggerUser.comment = new Set();
			triggerUser.trigger_ids = new Set();
			matchingTriggerUsers.set(trigger.user_id.toString(), triggerUser);
		}
		
		for (let action of trigger.actions) {
			triggerUser.actions.add(action);
		}
		
		if (trigger.comment && !trigger.internal) {
			triggerUser.comment.add(trigger.comment);
		}

		if (trigger._id) {
			triggerUser.trigger_ids.add(trigger._id);
		}
	}
	
	// Convert maps and sets back to arrays
	matchingTriggerUsers = [...matchingTriggerUsers.values()]
	for (let user of matchingTriggerUsers) {
		user.actions = [...user.actions];
		user.comment = [...user.comment];
		user.trigger_ids = [...user.trigger_ids];
	}
	
	return matchingTriggerUsers;
}

function reloadTriggers(callback) {
	if (reloading) {
		if (callback)
			reloadCallbackQueue.push(callback);
		return;
	}
	reloading = true;
	
	let newConditionMaps = {};
	let newTriggers = [];
	let newTriggersWithoutCommonConditions = [];
	let begin = process.hrtime();
	
	function addTrigger(trigger) {
		if (trigger.disabled || trigger.actions.length == 0) {
			return;
		}
		
		if (trigger._id) {
			trigger._id = trigger._id.toHexString();
		}

		let triggerNumber = newTriggers.push(trigger) - 1;
		
		// Go through all common conditions and add them to the maps
		let hasCommonCondition = false;
		for (let condition of config.matcher.commonConditions) {
			if (!newConditionMaps[condition]) {
				newConditionMaps[condition] = new Map();
			}
			
			let values = trigger.conditions[condition];
			if (values === undefined) {
				// This condition is not set in the trigger
				values = [null];
			} else {
				hasCommonCondition = true;
				if (!Array.isArray(values)) {
					values = [values];
				}
			}
			
			for (let value of values) {
				let conditionBitmap = newConditionMaps[condition].get(value);
				if (conditionBitmap === undefined) {
					newConditionMaps[condition].set(value, new RoaringBitmap32([triggerNumber]));
				} else {
					conditionBitmap.add(triggerNumber);
				}
			}
		}

		if (!hasCommonCondition) {
			newTriggersWithoutCommonConditions.push(trigger);
		}

		// Turn all uncommon condition values into Sets
		uncommonConditions.forEach(condition => {
			let values = trigger.conditions[condition];
			if (values !== undefined) {
				if (Array.isArray(values)) {
					trigger.conditions[condition] = new Set(values);
				} else {
					trigger.conditions[condition] = new Set([values]);
				}
			}
		});
	}
	
	async.series([
		callback => {
			db.collection('triggers').find({}).forEach(addTrigger, callback);
		},
		callback => {
			db.collection('users').find({}).forEach(user => {
				// Make internal trigger for the user's callsign
				addTrigger({
					internal: true,
					user_id: user._id,
					actions: ['myspot'],
					conditions: {callsign: user.username}
				});
			}, callback);
		}
	], err => {
		assert.equal(null, err);

		let diff = process.hrtime(begin);
		console.log(`Loaded ${newTriggers.length} (${newTriggersWithoutCommonConditions.length}) triggers in ${(diff[0] * 1e9 + diff[1])/1e9} seconds`);

		conditionMaps = newConditionMaps;
		triggers = newTriggers;
		triggersWithoutCommonConditions = newTriggersWithoutCommonConditions;

		if (callback) {
			callback(triggers.length);
		}

		for (let queuedCallback of reloadCallbackQueue) {
			queuedCallback(triggers.length);
		}
		reloadCallbackQueue = [];
		reloading = false;
	});
}

function arrayDiffSorted(a, b) {
	let i = 0, j = 0;
	let output = [];
	while (i < a.length && j < b.length) {
		if (a[i] < b[j]) {
			output.push(a[i]);
			i++;
		} else if (a[i] > b[j]) {
			j++;
		} else {
			i++;
			j++;
		}
	}
	while (i < a.length) {
		output.push(a[i]);
		i++;
	}
	return output;
}
