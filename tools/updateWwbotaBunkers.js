const request = require('request');
const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');
const parse = require('csv-parse');
const fs = require('fs');
const async = require('async');

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	processBunkersList(db);
});

function processBunkersList(db) {
	let schemes = new Map();
	
	request.get(config.wwbota.listUrl, {headers: {'User-Agent': 'Mozilla'}})
		.on('error', (err) => {
			callback(err);
			return;
		})
		.pipe(parse({columns: true, relax_column_count: true, relax: true}, (err, newBunkers) => {
			assert.equal(err, null);
			
			if (newBunkers.length < 20000) {
				callback(new Error("Bad number of WWBOTA bunkers, expecting more than 20000"));
				return;
			}
			
			for (let bunker of newBunkers) {
				if (bunker.Scheme) {
					let scheme = bunker.Scheme.trim().toUpperCase()
					let schemeData = schemes.get(scheme);
					if (!scheme) {
						schemeData = {scheme: scheme, dxcc: bunker.DXCC, program: 'wwbota'};
						schemes.set(scheme, schemeData);
					}
				}
			}
					
			let schemesCollection = db.collection('wwbotaSchemes');
			schemesCollection.deleteMany({});
			schemesCollection.insertMany([...schemes.values()]);
			client.close();
		}));
}
