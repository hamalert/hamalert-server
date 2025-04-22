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
	
	processParksList(db);
});

function processParksList(db) {
	let parks = [];
	let divisions = new Map();
	
	async.series([
		// WWFF
		(callback) => {
			request.get(config.wwff.listUrl, {headers: {'User-Agent': 'Mozilla'}})
				.on('error', (err) => {
					callback(err);
					return;
				})
				.pipe(parse({columns: true, relax_column_count: true, relax: true}, (err, newParks) => {
					assert.equal(err, null);
					
					if (newParks.length < 30000) {
						callback(new Error("Bad number of WWFF parks, expecting more than 30000"));
						return;
					}
					
					let seenParkRefs = new Set();
					for (let park of newParks) {
						if (park.reference === 'reference') {
							// Skip stray CSV header mid-file
							continue;
						}
						if (seenParkRefs.has(park.reference)) {
							//console.log(`Duplicate WWFF reference ${park.reference}`);
							continue;
						}
						seenParkRefs.add(park.reference);

						delete park.changeLog;
				
						for (let key in park) {
							if (park[key] === '' || park[key] === '-' || park[key] === 'n/a' || park[key] === '0000-00-00') {
								delete park[key];
							}
						}
				
						park.division = getDivision(park.reference);
				
						let division = divisions.get(park.division);
						if (!division) {
							division = {division: park.division, name: park.division, program: 'wwff'};
							divisions.set(park.division, division);
						}
						
						park.program = 'wwff';
						parks.push(park);
					}
					
					callback();
				}));
		},
		
		// POTA
		(callback) => {
			axios.get(config.pota.apiUrl + '/programs/locations')
				.then(response => {
					let programLoads = [];
					let seenPrefixes = new Set();
					if (response.data.length < 50) {
						callback(new Error("Bad number of POTA programs, expecting more than 50"));
						return;
					}
					response.data.forEach(program => {
						if (seenPrefixes.has(program.prefix)) {
							// Ignore duplicate programs
							return;
						}
						seenPrefixes.add(program.prefix);
						programLoads.push((callback2) => {
							axios.get(config.pota.apiUrl + '/program/parks/' + program.prefix)
								.then(response2 => {
									if (program.prefix == 'VK' && response2.data.length < 3000) {
										callback(new Error("Bad number of VK POTA parks, expecting more than 3000"));
										return;
									}

									response2.data.forEach(park => {
										let parkFixed = {
											reference: park.reference,
											name: park.name,
											location: park.locationDesc,
											status: 'active',
											program: 'pota'
										};

										parkFixed.division = program.prefix;
				
										let division = divisions.get(parkFixed.division);
										if (!division) {
											division = {division: parkFixed.division, name: parkFixed.division, program: 'pota'};
											divisions.set(parkFixed.division, division);
										}
										
										parks.push(parkFixed);
									});
									callback2();
								})
								.catch(error => {
									callback2(error);
								})
						});
					});
					async.series(programLoads, (err, results) => {
						if (err) {
							callback(err);
							return;
						}

						callback();
					});
				})
				.catch(error => {
					callback(error);
				});
		},
		
		// QCPOTA
		/*(callback) => {
			request.get(config.qcpotaListUrl)
				.on('error', (err) => {
					callback(err);
					return;
				})
				.pipe(parse({columns: ['Designator','Name','Location'], delimiter: ';', relax_column_count: true, relax: true, from_line: 2, encoding: 'latin1'}, (err, newParks) => {
					assert.equal(err, null);
					
					if (newParks.length < 200) {
						callback(new Error("Bad number of QCPOTA parks, expecting more than 200"));
						return;
					}
					
					let seenParkRefs = new Set();
					for (let park of newParks) {						
						if (seenParkRefs.has(park.Designator)) {
							console.log(`Duplicate QCPOTA reference ${park.Designator}`);
							continue;
						}
						seenParkRefs.add(park.Designator);
						
						let parkFixed = {
							reference: park.Designator,
							name: park.Name.replace('', '\''),
							location: park.Location,
							status: 'active',
							program: 'qcpota',
							division: 'QCPOTA'
						};
			
						let division = divisions.get(parkFixed.division);
						if (!division) {
							division = {division: parkFixed.division, name: parkFixed.division, program: 'qcpota'};
							divisions.set(parkFixed.division, division);
						}
						
						parks.push(parkFixed);
					}
				
					callback();
				}));
		}*/
	], async (err, results) => {
		if (err) {
			console.error(err);
			client.close();
			return;
		}
		
		let collection = db.collection('wwffParks');
		let divisionsCollection = db.collection('wwffDivisions');
		await collection.deleteMany({});
		await collection.insertMany(parks);
		await divisionsCollection.deleteMany({});
		await divisionsCollection.insertMany([...divisions.values()]);
		client.close();
	});
}


var wwffRegex = /^(.+)-(\d+)$/;
function getDivision(wwffRef) {
	let matches = wwffRegex.exec(wwffRef);
	if (matches) {
		return matches[1];
	} else {
		throw Error("Bad WWFF ref '" + wwffRef + "'");
	}
}
