const request = require('request');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config');
const assert = require('assert');
const parse = require('csv-parse');
const fs = require('fs');
const async = require('async');

console.error('Disabled (WIP)');
process.exit();

let client = new MongoClient(config.mongodb.url)
client.connect((err) => {
	assert.equal(null, err);
	let db = client.db(config.mongodb.dbName);
	
	processSummitList(db);
});

function processSummitList(db) {
	let summits = [];
	let oldAssociationNames = new Map();
	let associations = new Map();
	let body;
	
	async.series([
		cb => {
			request(config.gma.summitListUrl, (error, response, mbody) => {
				assert.equal(error, null);
		
				body = mbody.substring(mbody.indexOf("\n")+1, mbody.length);
		
				// Fix anomaly
				body = body.replace('"Oberfeld  "Edwinshoehe""', '"Oberfeld Edwinshoehe"');
		
				cb();
			});
		},
		
		cb => {
			// Obtain current list of GMA associations so we can retain the names
			db.collection('associations').find({Program: 'gma'}).toArray((err, oldDbAssociations) => {
				for (let assoc of oldDbAssociations) {
					oldAssociationNames.set(assoc['Association'], assoc['Name']);
				}
				cb();
			});
		},
		
		cb => {
			parse(body, {columns: true, relax_column_count: true, ltrim: true}, function(err, gmaSummits) {
				assert.equal(err, null);
		
				for (let gmaSummit of gmaSummits) {
					// Ignore SOTA regions
					if (config.gma.ignoreRegex.test(gmaSummit.Reference)) {
						continue;
					}
			
					try {
						let summit = {
							SummitCode: gmaSummit.Reference,
							SummitName: gmaSummit.Name,
							AltM: gmaSummit['Height (m)'],
							Longitude: gmaSummit.Longitude,
							Latitude: gmaSummit.Latitude,
							BonusPoints: 3,
							ValidFrom: gmaSummit['valid from'],
							ValidTo: gmaSummit['valid to'],
							ActivationCount: gmaSummit.Activations,
							ActivationDate: gmaSummit['last activated by'],
							ActivationCall: gmaSummit['last activator call']
						};
				
						summit.Points = Math.floor(gmaSummit['Height (m)']/100);
						if (summit.Points < 1)
							summit.Points = 1;
		
						summit.ValidFrom = gmaDateToMongo(summit.ValidFrom);
						summit.ValidTo = gmaDateToMongo(summit.ValidTo, true);
			
						summit.SummitCode = summit.SummitCode.trim();
						summit.SummitAssociation = getAssociation(summit.SummitCode);
						summit.SummitRegion = getRegion(summit.SummitCode);
			
						var association = associations.get(summit.SummitAssociation);
						if (!association) {
							association = {Association: summit.SummitAssociation, Name: oldAssociationNames.get(summit.SummitAssociation), Regions: new Map(), Program: 'gma'};
							if (!association.Name) {
								association.Name = association.Association + " (GMA)";
							}
							associations.set(summit.SummitAssociation, association);
						}
						association.Regions.set(summit.SummitRegion, {Region: summit.SummitRegion, Name: summit.SummitRegion});
			
						summit.Program = 'gma';
			
						delete summit.AssociationName;
						delete summit.RegionName;
				
						summits.push(summit);
					} catch (e) {
						console.log(`Ignoring summit due to error: ${e}`);
					}
				}
		
				for (let association of associations.values()) {
					association.Regions = [...association.Regions.values()];
				}
		
				if (summits.length < 10000) {
					console.error("Bad number of summits, expecting more than 10000");
					client.close();
					cb();
					return;
				}
		
				var collection = db.collection('summits');
				var associationCollection = db.collection('associations');
				collection.deleteMany({Program: 'gma'}, () => {
					collection.insertMany(summits, (err, r) => {
						if (err)
							console.error(err);
				
						associationCollection.deleteMany({Program: 'gma'}, () => {
							associationCollection.insertMany([...associations.values()], (err, r) => {
								if (err)
									console.error(err);
								client.close();
								cb();
							});
						});
					});
				});
			});
		}
	]);
}

function gmaDateToMongo(date, endOfDay = false) {
	var dateRegex = /^(\d\d\d\d)(\d\d)(\d\d)$/;
	var matches = dateRegex.exec(date);
	if (matches) {
		if (endOfDay) {
			return new Date(Date.UTC(matches[1], matches[2]-1, matches[3], 23, 59, 59, 999));
		} else {
			return new Date(Date.UTC(matches[1], matches[2]-1, matches[3]));
		}
	} else {
		throw Error("Bad date " + date);
	}
}

var summitRegex = /^(.+)\/(.+)-(\d+)$/;
function getAssociation(summitRef) {
	var matches = summitRegex.exec(summitRef);
	if (matches) {
		return matches[1];
	} else {
		throw Error("Bad summit ref '" + summitRef + "'");
	}
}

function getRegion(summitRef) {
	var matches = summitRegex.exec(summitRef);
	if (matches) {
		return matches[2];
	} else {
		throw Error("Bad summit ref '" + summitRef + "'");
	}
}

