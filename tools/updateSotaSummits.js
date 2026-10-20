const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
const config = require('../config_loader');
const assert = require('assert');
const { parse } = require('csv-parse');

let client = new MongoClient(config.mongodb.url)
client.connect().then(() => {
	let db = client.db(config.mongodb.dbName);
	
	processSummitList(db);
}).catch((err) => {
	console.error(err);
	process.exit(1);
});

function processSummitList(db) {
	var associations = new Map();
	axios.get(config.summitListUrl, {responseType: 'text'})
		.then(response => {
			let body = response.data.substring(response.data.indexOf("\n")+1, response.data.length);
			parse(body, {columns: true, relax_column_count: true}, function(err, summits){
				assert.equal(err, null);
				for (let summit of summits) {
					delete summit.GridRef1;
					delete summit.GridRef2;
					delete summit.AltFt;
					delete summit.undefined;
					summit.ValidFrom = dateToMongo(summit.ValidFrom);
					summit.ValidTo = dateToMongo(summit.ValidTo, true);
					summit.SummitCode = summit.SummitCode.trim();	//anomaly GW/NW-003
					summit.SummitAssociation = getAssociation(summit.SummitCode);
					summit.SummitRegion = getRegion(summit.SummitCode);
					var association = associations.get(summit.SummitAssociation);
					if (!association) {
						association = {Association: summit.SummitAssociation, Name: summit.AssociationName, Regions: new Map(), Program: 'sota'};
						associations.set(summit.SummitAssociation, association);
					}
					association.Regions.set(summit.SummitRegion, {Region: summit.SummitRegion, Name: summit.RegionName});
					summit.Program = 'sota';
					delete summit.AssociationName;
					delete summit.RegionName;
				}
				for (let association of associations.values()) {
					association.Regions = [...association.Regions.values()];
				}
				if (summits.length < 100000) {
					console.error("Bad number of summits, expecting more than 100000");
					client.close();
					return;
				}
				var collection = db.collection('summits');
				var associationCollection = db.collection('associations');
				(async () => {
					try {
						await collection.deleteMany({Program: 'sota'});
					} catch (err) {
						console.error(err);
					}
					try {
						await collection.insertMany(summits);
					} catch (err) {
						console.error(err);
					}
					try {
						await associationCollection.deleteMany({Program: 'sota'});
					} catch (err) {
						console.error(err);
					}
					try {
						await associationCollection.insertMany([...associations.values()]);
					} catch (err) {
						console.error(err);
					}
				})().finally(() => {
					client.close();
				});
			});
		})
		.catch(error => {
			console.error(error);
			client.close();
		});
}

function dateToMongo(date, endOfDay = false) {
	let dateRegex = /^(\d\d)\/(\d\d)\/(\d\d\d\d)$/;
	let dateRegex2 = /^(\d\d\d\d)-(\d\d)-(\d\d)/;
	let matches = dateRegex.exec(date);
	let matches2 = dateRegex2.exec(date);
	if (matches) {
		if (endOfDay) {
			return new Date(Date.UTC(matches[3], matches[2]-1, matches[1], 23, 59, 59, 999));
		} else {
			return new Date(Date.UTC(matches[3], matches[2]-1, matches[1]));
		}
	} else if (matches2) {
		if (endOfDay) {
			return new Date(Date.UTC(matches2[1], matches2[2]-1, matches2[3], 23, 59, 59, 999));
		} else {
			return new Date(Date.UTC(matches2[1], matches2[2]-1, matches2[3]));
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

