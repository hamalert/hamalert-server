/*
	Local development config, for use with `npm run local-dev` (tools/localDev.js), which points
	HAMALERT_CONFIG at this file so config_loader.js picks it up instead of the gitignored
	production ./config.js. Runs with no credentials at all: no Club Log key, no push
	notification credentials, no RBN/cluster telnet logins. See LOCAL_DEV.md.

	This is NOT meant for production use.
*/
var path = require('path');
var config = {};

config.sotaWatch = {
	spotsUrl: 'https://api-db2.sota.org.uk/api/spots/50/all/all',
	epochUrl: 'https://api-db2.sota.org.uk/api/spots/epoch',
	refreshInterval: 30*1000,
	spotMaxAge: 5*60*1000
};

config.pota = {
	spotsUrl: 'https://api.pota.app/spot/activator',
	apiUrl: 'https://api.pota.app',
	refreshInterval: 60*1000,
	spotMaxAge: 5*60*1000
};

config.wwff = {
	listUrl: 'http://wwff.co/wwff-data/wwff_directory.csv'
};

config.mongodb = {
	url: 'mongodb://127.0.0.1:27117/hamalert',
	dbName: 'hamalert'
};

config.redis = {
	server: {
		port: 6479,
		host: '127.0.0.1',
		db: 0
	},
	spotMaxAge: 86400*1000
};

config.rateLimit = {
	dumpFile: path.join(__dirname, '.local', 'cache', 'ratelimit.dump'),
	maxFrequencyDiff: 0.0004,
	maxFrequencyDiffDigi: 0.003,
	digiModes: ['psk', 'rtty', 'jt', 'msk', 'ft2', 'ft4', 'ft8', 'js8', 'qra64', 'iscat', 'fsk441', 't10', 'q65', 'sstv', 'varac', 'olivia', 'fst4'],
	disabled: true	// local development: never rate-limit alerts, so every matching spot is visible
};

config.limitLog = {
	databaseUpdateInterval: 60000
};

config.matchLog = {
	databaseUpdateInterval: 60000
};

config.stats = {
	flushInterval: 60000
};

config.clublog = {
	apiKey: null,	// no key locally: clublog.js skips lookups entirely (no DXCC on spots)
	cacheSize: 100000,
	cacheAge: 86400*1000,
	reloadInterval: 86400*1000,
	dumpFile: path.join(__dirname, '.local', 'cache', 'clublog.dump'),
	pruneInterval: 600000,
	qslStatusValues: {
		"confirmed": 1,
		"worked": 2,
		"verified": 3
	},
	modeValues: {
		"all": 0,
		"cw": 1,
		"phone": 2,
		"data": 3
	},
	noLookupCallsignsRegex: /APRS2SOTA|^SMS|^[A-Z]+$/
};

config.threema = {
	apiId: '*HAMALRT',
	apiSecret: 'local-dev-placeholder',
	privateKey: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', 'hex'),
	creditsWarningThreshold: 100000
};

config.mail = {
	transport: {
		host: 'localhost',
		port: 25,
		auth: {
			user: "local-dev-placeholder",
			pass: "local-dev-placeholder"
		}
	},
	from: 'spot@hamalert.invalid'
};

// No config.apns / config.fcm: notify/app.js skips push notifiers entirely when these are absent.

// No RBN or cluster telnet feeds locally: they need a real callsign login.
config.rbn = [];
config.cluster = [];

config.pskreporter = {
	url: "https://stream.pskreporter.info/stream/report?token=",
	timeout: 300000,
	maxAge: 900000,
	quorum: 3,	// how many different spotters must see a call/band/mode combination before spots are deemed valid
	quorumInterval: 15*60*1000,
	disabled: true,	// needs a token
	spotterLookupDxccRegex: /^(([A-Z]{1,2}[0-9]?|[0-9][A-Z])\/)?([A-Z]{1,2}|[0-9][A-Z])[0-9]{1,2}[A-Z]{1,4}(\/(M|P|QRP|[0-9]))?(-[0-9])?$/i,
	spotterFilterRegex: /^(N0CALL|W\/SWL)/i
};

config.dstar = {
	// D-STAR presence: QuadNet and ircDDB "last heard" logs (see dstar.js)
	quadnet: {
		url: 'https://www.openquad.net/ics/ics',
		pollInterval: 15000,
		timeout: 20000,
		tailBytes: 65536,
		disabled: false
	},
	ircddb: {
		url: 'http://live.ircddb.net:8080/jj3.yaws',
		pollInterval: 15000,
		timeout: 20000,
		//connectProxy: 'http://127.0.0.1:3128',	// only for development environments that require an HTTP CONNECT proxy
		disabled: false
	},
	dstarusers: {
		url: 'https://www.dstarusers.org/lastheard.php',
		pollInterval: 30000,
		timeout: 20000,
		disabled: false
	},
	// D-STAR node/reflector frequency directory (see dstar_nodes.js); used by server.js to
	// resolve frequency/band for spots emitted by dstar.js
	nodeLists: {
		quadnetUrl: 'https://www.openquad.net/gateway.php',
		ircddbUrl: 'https://status.ircddb.net/repeater.php',
		refreshInterval: 3600*1000,
		dumpFile: path.join(__dirname, '.local', 'cache', 'dstar-nodes.dump')
	},
	dedupeInterval: 15*60*1000,		// one alert per callsign/event/node/reflector within this window
	maxAge: 10*60*1000,				// ignore records older than this
	headerMergeInterval: 10*60*1000,	// how long to remember ircDDB header records (TX message) for their stats record
	minVoiceDuration: 2,				// seconds; shorter transmissions are not considered voice
	minVoiceDurationLinkCommand: 5,	// seconds; a link command held this long is also treated as voice
	ignoreDirectedCalls: true,		// do not alert on callsign-routed (directed) calls
	disabled: false
};

config.simulator = {
	port: 1983,
	address: '0.0.0.0'	// so a web app container can reach the simulator via host.docker.internal
};

config.summitListUrl = 'https://www.sotadata.org.uk/summitslist.csv';

config.gma = {
	summitListUrl: 'http://cqgma.eu/gma_summits.csv',
	ignoreRegex: /^(DL|DM|OY|X)/
};

//config.qcpotaListUrl = 'https://www.qsl.net/ve2pij/QCPOTA.csv';
config.iotaListUrl = 'https://www.iota-world.org/islands-on-the-air/downloads/download-file.html?path=fulllist.json';

config.bands = [
	{from: 0.135, to: 0.138, band: "2200m"},
	{from: 0.472, to: 0.479, band: "600m"},
	{from: 1.8, to: 2, band: "160m"},
	{from: 3.5, to: 4, band: "80m"},
	{from: 5, to: 5.5, band: "60m"},
	{from: 7, to: 7.3, band: "40m"},
	{from: 10, to: 10.2, band: "30m"},
	{from: 14, to: 14.5, band: "20m"},
	{from: 18, to: 18.2, band: "17m"},
	{from: 21, to: 21.5, band: "15m"},
	{from: 24.8, to: 25, band: "12m"},
	{from: 26, to: 27.999, band: "11m"},
	{from: 28, to: 30, band: "10m"},
	{from: 40, to: 41, band: "8m"},
	{from: 50, to: 54, band: "6m"},
	{from: 70, to: 71, band: "4m"},
	{from: 144, to: 148, band: "2m"},
	{from: 219, to: 225, band: "1.25m"},
	{from: 420, to: 450, band: "70cm"},
	{from: 902, to: 928, band: "33cm"},
	{from: 1200, to: 1400, band: "23cm"},
	{from: 2300, to: 2450, band: "13cm"},
	{from: 3300, to: 3500, band: "9cm"},
	{from: 5400, to: 5925, band: "6cm"},
	{from: 10489.550, to: 10490, band: "3cm_qo100"},
	{from: 10000, to: 10500, band: "3cm"}
];

config.bandRangesToBands = {
	"lf": ["2200m"],
	"mf": ["600m", "160m"],
	"hf": ["80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "11m", "10m"],
	"vhf": ["8m", "6m", "4m", "2m", "1.25m"],
	"uhf": ["70cm", "33cm", "23cm", "13cm"],
	"shf": ["9cm", "6cm", "3cm_qo100", "3cm"]
};

config.crashNotifyMail = {
	transport: {
		host: 'localhost',
		port: 25,
		auth: {
			user: "local-dev-placeholder",
			pass: "local-dev-placeholder"
		}
	},
	from: 'pm2@hamalert.invalid',
	to: 'nobody@hamalert.invalid'
};

config.userCache = {
	maxAge: 60000
};

config.matcher = {
	numProcesses: 1,
	port: 1984,
	address: '127.0.0.1',
	ipcTimeout: 10000,
	reloadInterval: 60000,
	conditions: [
		'source',
		'callsign',
		'notCallsign',
		'fullCallsign',
		'notFullCallsign',
		'prefix',
		'notPrefix',
		'summitAssociation',
		'summitRegion',
		'summitRef',
		'wwffRef',
		'mode',
		'band',
		'spotter',
		'notSpotter',
		'spotterPrefix',
		'daysOfWeek',
		'dxcc',
		'callsignDxcc',
		'spotterDxcc',
		'cq',
		'itu',
		'continent',
		'spotterContinent',
		'spotterCq',
		'wwffDivision',
		'iotaGroupRef',
		'bandslot',
		'state',
		'spotterState',
		'qsl',
		'dvEvent',
		'dvNode',
		'dvReflector'
	],
	// Commonly used conditions for hash table optimization (cannot contain 'not' conditions!)
	commonConditions: [
		'callsign',
		'band',
		'mode',
		'dxcc',
		'fullCallsign',
		'source',

		'prefix',
		'summitAssociation',
		'summitRegion',
		'summitRef',
		'wwffRef',
		'spotter',
		'spotterPrefix',
		'daysOfWeek',
		'callsignDxcc',
		'spotterDxcc',
		'cq',
		'itu',
		'continent',
		'spotterContinent',
		'spotterCq',
		'wwffDivision',
		'iotaGroupRef',
		'bandslot',
		'state',
		'spotterState',
		'qsl',
		'dvEvent',
		'dvNode',
		'dvReflector'
	]
};

config.modeguesser = {
	ranges: [
		{from: 1.81, to: 1.840, mode: 'cw'},
		{from: 1.843, to: 2.000, mode: 'ssb'},
		{from: 3.500, to: 3.570, mode: 'cw'},
		{from: 3.600, to: 3.800, mode: 'ssb'},
		{from: 5.351, to: 5.356, mode: 'cw'},
		{from: 5.357, to: 5.359, mode: 'ft8'},
		{from: 5.360, to: 5.366, mode: 'ssb'},
		{from: 5.371, to: 5.372, mode: 'ssb'},
		{from: 5.373, to: 5.373, mode: 'cw'},
		{from: 5.403, to: 5.404, mode: 'ssb'},
		{from: 5.405, to: 5.405, mode: 'cw'},
		{from: 7.000, to: 7.040, mode: 'cw'},
		{from: 7.080, to: 7.300, mode: 'ssb'},
		{from: 10.100, to: 10.130, mode: 'cw'},
		{from: 14.000, to: 14.070, mode: 'cw'},
		{from: 14.112, to: 14.350, mode: 'ssb'},
		{from: 18.068, to: 18.095, mode: 'cw'},
		{from: 18.111, to: 18.168, mode: 'ssb'},
		{from: 21.000, to: 21.070, mode: 'cw'},
		{from: 21.151, to: 21.450, mode: 'ssb'},
		{from: 24.890, to: 24.914, mode: 'cw'},
		{from: 24.931, to: 24.990, mode: 'ssb'},
		{from: 28.000, to: 28.070, mode: 'cw'},
		{from: 28.300, to: 29.000, mode: 'ssb'},
		{from: 29.000, to: 29.200, mode: 'fm'},
		{from: 50.000, to: 50.100, mode: 'cw'},
		{from: 50.200, to: 50.300, mode: 'ssb'},
		{from: 10489.505, to: 10489.539, mode: 'cw'},  // QO-100
		{from: 10489.650, to: 10489.744, mode: 'ssb'}, // QO-100
		{from: 10489.755, to: 10489.849, mode: 'ssb'}  // QO-100
	],
	commentPattern: /\b(psk\d*|rtty|jt65|jt9|msk\d*|ft[248]|js8|qra64|iscat|fsk441|t10|sstv|varac|olivia|fst4)\b/i
};

config.accountPruning = {
	reminderInterval: 180*24*60*60*1000,
	deleteInterval: 210*24*60*60*1000
};

config.uselessTriggerDetection = {
	matchThreshold: 10000
};

config.lotw = {
	userListUrl: 'https://lotw.arrl.org/lotw-user-activity.csv',
	minActivityDays: 365
};

config.eqsl = {
	userListUrl: 'https://www.eqsl.cc/qslcard/DownloadedFiles/AGMemberList.txt'
};

config.state = {
	//fccDatabaseUrl: 'ftp://wirelessftp.fcc.gov/pub/uls/complete/l_amat.zip'
	fccDatabasePath: '/data/hamalert/download/l_amat.zip',
	canadaDatabaseUrl: 'https://apc-cap.ic.gc.ca/datafiles/amateur_delim.zip'
};

config.telnetsrv = {
	port: 7300
};

module.exports = config;
