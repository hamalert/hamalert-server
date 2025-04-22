const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');
const fs = require('fs');

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	processDxccList(db);
});

// input file format (tab delimited):
// prefix	name	continent	itu	cq	dxcc
// 3DA	Swaziland	AF	57	38	468
// multiple prefixes, itu/cq zones delimited with "," and ranges with "-"

async function processDxccList(db) {
	var dxccs = [];
	
	dxccList = fs.readFileSync("dxcc.txt", {encoding: "utf8"});
	
	let lines = dxccList.split("\n");
	lines.shift();
	for (let line of lines) {
		let fields = line.split("\t");
		if (fields[1] === '')
			continue;
	
		let dxcc = {
			prefixes: fields[0],
			country: fields[1],
			continent: fields[2].split(','),
			dxcc: parseInt(fields[5])
		};
		
		dxcc.itu = [];
		enumerateZones(fields[3], (ituZone) => {
			dxcc.itu.push(parseInt(ituZone));
		});
		
		dxcc.cq = [];
		enumerateZones(fields[4], (cqZone) => {
			dxcc.cq.push(parseInt(cqZone));
		});
		
		dxccs.push(dxcc);
	}

	console.log(dxccs);
	
	let collection = db.collection('dxccs');
	await collection.deleteMany({});
	await collection.insertMany(dxccs);
	await collection.createIndex({dxcc: 1}, {unique: true});
	client.close();
}

function enumerateZones(zoneList, callback) {
	let zones = zoneList.split(",");
	for (let zone of zones) {
		// Is this a range of zones?
		var zonesRegex = /^(.+)-(.+)$/;
		var matches = zonesRegex.exec(zone);
		
		if (matches) {
			var startZone = parseInt(matches[1]);
			var endZone = parseInt(matches[2]);
			for (let i = startZone; i <= endZone; i++) {
				callback(i);
			}
		} else {
			callback(parseInt(zone));
		}
	}
}
