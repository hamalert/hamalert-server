/*
	Seed a local MongoDB with a test user and three D-STAR triggers (see LOCAL_DEV.md).

	Usage: MONGO_URL=mongodb://127.0.0.1:27017/hamalert USERNAME=HB9DQM PASSWORD=testpass123 node tools/seedLocalUser.js

	The third trigger matches EVERY D-STAR spot (condition: mode = dstar, nothing else), which the
	web trigger editor deliberately doesn't allow; it is injected here so that local testing shows
	all D-STAR activity in the Alerts page, the app and telnet. Set DSTAR_CATCHALL=0 to skip it,
	or delete it on the website to test specific triggers in isolation.

	Re-runnable: the user and the triggers created by this script are replaced on each run.
	Uses the server's own mongodb and bcryptjs modules, so the password hash is compatible with
	the telnet notifier and the web app's login.
*/
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/hamalert';
const dbName = process.env.DB_NAME || 'hamalert';
const username = (process.env.USERNAME || 'HB9DQM').toUpperCase();
const password = process.env.PASSWORD || 'testpass123';
const catchAll = process.env.DSTAR_CATCHALL !== '0';

async function main() {
	const client = new MongoClient(mongoUrl);
	await client.connect();
	const db = client.db(dbName);

	await db.collection('users').deleteMany({username});
	await db.collection('triggers').deleteMany({comment: {$in: ['local test: my callsign on D-STAR', 'local test: anyone on REF030', 'local test: every D-STAR spot']}});

	const userResult = await db.collection('users').insertOne({
		username,
		password: bcrypt.hashSync(password, 10),
		accountEmail: 'test@example.invalid',
		alerts: true,
		limit: {count: 100, interval: 3600},
		limitPerCallsignFreqMode: {count: 1, interval: 600},
		limitSeparateSotaWatch: true,
		signupDate: new Date(),
		signupIpAddr: '127.0.0.1'
	});
	const userId = userResult.insertedId;

	await db.collection('triggers').insertOne({
		user_id: userId,
		// mode, not source: source now names the feed (quadnet/ircddb/dstarusers), and this
		// trigger should match a callsign heard on D-STAR regardless of which feed reported it.
		conditions: {callsign: username, mode: 'dstar', dvEvent: 'active'},
		actions: ['telnet', 'app'],
		comment: 'local test: my callsign on D-STAR'
	});

	await db.collection('triggers').insertOne({
		user_id: userId,
		conditions: {dvReflector: 'REF030'},	// no module letter: matches REF030-A, REF030-B, ...
		actions: ['telnet', 'app'],
		comment: 'local test: anyone on REF030'
	});

	if (catchAll) {
		await db.collection('triggers').insertOne({
			user_id: userId,
			conditions: {mode: 'dstar'},	// every D-STAR spot from every feed; not creatable in the web editor
			actions: ['telnet', 'app'],
			comment: 'local test: every D-STAR spot'
		});
	}

	console.log(`User ${username} (password "${password}") created with _id ${userId}`);
	console.log(`${catchAll ? 'Three' : 'Two'} triggers (telnet + app actions) created${catchAll ? ', including one that matches every D-STAR spot (DSTAR_CATCHALL=0 to skip)' : ''}. Simulate a spot with:`);
	console.log(`curl -X POST http://127.0.0.1:1983/sendSpot -H 'Content-Type: application/json' -d '{"user_id":"${userId}","source":"quadnet","fullCallsign":"${username}","mode":"dstar","dvEvent":"active","dvNode":"${username}-B","dvReflector":"REF030-C"}'`);
	await client.close();

	// Machine-readable, for tools/localDev.js to pick up (keep this the last line of output)
	console.log(`USER_ID=${userId}`);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
