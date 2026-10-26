// Run from cron every few minutes:
//   node tools/spotWatchdog.js
// Emails config.watchdog.notifyMail when a monitored source has gone longer
// than its interval without a processed spot. Timestamps are written by stats.js.

const {MongoClient} = require('mongodb');
const nodemailer = require('nodemailer');
const config = require('../config_loader');

function staleSources(lastSeen, now, sources) {
	return sources.filter((entry) => {
		let seen = lastSeen && lastSeen[entry.source];
		if (!(seen instanceof Date) || Number.isNaN(seen.getTime()))
			return true;
		return (now - seen) >= entry.interval;
	});
}

function formatDuration(ms) {
	if (ms % 60000 === 0)
		return `${ms / 60000} min`;
	return `${Math.round(ms / 1000)} sec`;
}

function formatReport(lastSeen, now, sources) {
	return sources.map((entry) => {
		let interval = formatDuration(entry.interval);
		let seen = lastSeen && lastSeen[entry.source];
		if (!(seen instanceof Date) || Number.isNaN(seen.getTime()))
			return `${entry.source}: never (interval ${interval})`;
		let ageMin = Math.floor((now - seen) / 60000);
		return `${entry.source}: ${seen.toISOString()} (${ageMin} min ago, interval ${interval})`;
	}).join('\n');
}

async function main() {
	let watchdog = config.watchdog;
	if (!watchdog || !watchdog.notifyMail || !Array.isArray(watchdog.sources))
		throw new Error('config.watchdog must set notifyMail and sources');

	let client = new MongoClient(config.mongodb.url);
	try {
		await client.connect();
		let db = client.db(config.mongodb.dbName);
		let doc = await db.collection('heartbeat').findOne({_id: 'spots'});
		let now = new Date();
		let stale = staleSources(doc, now, watchdog.sources);
		if (stale.length === 0)
			return;

		let names = stale.map((entry) => entry.source).join(', ');
		let transporter = nodemailer.createTransport(watchdog.notifyMail.transport);
		await transporter.sendMail({
			from: watchdog.notifyMail.from,
			to: watchdog.notifyMail.to,
			subject: `No recent spots from ${names}`,
			text: `No spot has been processed within the watchdog interval for: ${names}.\n\n${formatReport(doc, now, watchdog.sources)}\n`
		});
	} finally {
		await client.close();
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

module.exports = {staleSources, formatReport};
