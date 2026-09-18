const MongoClient = require('mongodb').MongoClient;
const config = require('../config_loader');
const assert = require('assert');
const parse = require('csv-parse');
const fs = require('fs');
const unzipper = require('unzipper');
const Transform = require('stream').Transform;
const axios = require('axios');

const BULK_WRITE_SIZE = 1024;

let bulkOperations = [];

// Run in parallel
let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	processFccDatabase(db);
});

let client2 = new MongoClient(config.mongodb.url)
client2.connect((err) => {
	assert.equal(null, err);
	let db = client2.db(config.mongodb.dbName);
	
	processCanadaDatabase(db);
});

function processFccDatabase(db) {
	fs.createReadStream(config.state.fccDatabasePath)
		.on('error', err => {
			console.error(err);
			client.close();
			return;
		})
		.pipe(unzipper.Parse())
		.on('entry', entry => {
			if (entry.path == 'EN.dat') {
				let parser = parse({delimiter: '|', quote: null});
				// EN.dat can contain multiple rows per callsign and is not sorted by Unique System Identifier
				let bestByCallsign = new Map();
				let myTransform = new Transform({
					transform(chunk, encoding, cb) {
						let callsign = chunk[4];
						let ulsId = parseInt(chunk[1], 10);
						if (!callsign || Number.isNaN(ulsId)) {
							cb();
							return;
						}
						let prev = bestByCallsign.get(callsign);
						if (prev !== undefined && prev.ulsId > ulsId) {
							cb();
							return;
						}
						bestByCallsign.set(callsign, {
							ulsId,
							state: chunk[17] ? chunk[17].toUpperCase() : null
						});
						cb();
					},
					flush(cb) {
						let fccOperations = [];
						for (let [callsign, rec] of bestByCallsign) {
							if (!rec.state) {
								continue;
							}
							fccOperations.push({
								updateOne: {
									filter: {callsign},
									update: { $set: { state: 'US_' + rec.state } },
									upsert: true
								}
							});
						}
						const writeBatch = () => {
							if (fccOperations.length === 0) {
								client.close();
								cb();
								return;
							}
							let myBulkOperations = fccOperations.splice(0, BULK_WRITE_SIZE);
							db.collection('callsignInfo').bulkWrite(myBulkOperations, (err) => {
								if (err)
									console.error(err);
								writeBatch();
							});
						};
						writeBatch();
					},
					objectMode: true
				});

				entry.pipe(parser).pipe(myTransform);
			} else {
				entry.autodrain();
			}
		})
}

function processCanadaDatabase(db) {
	axios({
		url: config.state.canadaDatabaseUrl,
		responseType: 'stream',
		method: 'GET'
	})
	.then(response => {
		response.data
			.on('error', err => {
				console.error(err);
				client2.close();
				return;
			})
			.pipe(unzipper.Parse())
			.on('entry', entry => {
				if (entry.path == 'amateur_delim.txt') {
					let parser = parse({delimiter: ';', quote: null});
					parser.on('error', err => {
						console.error(err);
						client2.close();
					})
					let myTransform = new Transform({
						transform(chunk, encoding, cb) {
							if (!chunk[5]) {
								cb();
								return;
							}
							bulkOperations.push({
								updateOne: {
									filter: {callsign: chunk[0]},
									update: { $set: { state: 'CA_' + chunk[5].toUpperCase() } },
									upsert: true
								}
							});
							flushBulkOperations(db, false, cb);
						},
						flush(cb) {
							flushBulkOperations(db, true, () => {
								client2.close();
								cb();
							});
						},
						objectMode: true
					});
					entry.pipe(parser).pipe(myTransform);
				} else {
					entry.autodrain();
				}
			});
	})
	.catch(err => {
		console.error(err);
		client2.close();
	});
}

function flushBulkOperations(db, force, cb) {
	if (bulkOperations.length < BULK_WRITE_SIZE && !force) {
		cb();
		return;
	}

	let myBulkOperations = bulkOperations;
	bulkOperations = [];
	db.collection('callsignInfo').bulkWrite(myBulkOperations, (err, result) => {
		if (err)
			console.error(err);
		cb(err);
	});
}
