var config = {};

// Sanitized config with API keys, passwords etc. removed, not for use in production

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

config.wwbota = {
	spotsUrl: 'https://api.wwbota.org/spots/',
	listUrl: 'https://wwbota.org/wwbota-3',
	refreshInterval: 60*1000,
	spotMaxAge: 5*60*1000
};

config.mongodb = {
	url: 'mongodb://hamalert:<redacted>@localhost:27017/hamalert',
	dbName: 'hamalert'
};

config.redis = {
	server: {
		port: 6379,
		host: '127.0.0.1',
		db: 0
	},
	spotMaxAge: 86400*1000
};

config.rateLimit = {
	dumpFile: '/data/hamalert/cache/ratelimit.dump',
	maxFrequencyDiff: 0.0004,
	maxFrequencyDiffDigi: 0.003,
	digiModes: ['psk', 'rtty', 'jt', 'msk', 'ft8', 'ft4', 'js8call', 'qra64', 'iscat', 'fsk441', 't10', 'q65', 'sstv', 'varac', 'olivia', 'fst4']
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
	apiKey: '<redacted>',
	cacheSize: 100000,
	cacheAge: 86400*1000,
	reloadInterval: 86400*1000,
	dumpFile: '/data/hamalert/cache/clublog.dump',
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
	apiSecret: '<redacted>',
	privateKey: Buffer.from('<redacted>', 'hex'),
	creditsWarningThreshold: 100000
};

config.mail = {
	transport: {
		host: 'email-smtp.eu-central-1.amazonaws.com',
		port: 587,
		auth: {
			user: "<redacted>",
			pass: "<redacted>"
		}
	},
	from: 'spot@hamalert.org'
};

config.apns = {
	token: {
		key: `<redacted>
`,
		keyId: '<redacted>',
		teamId: '<redacted>'
	},
	production: true
};

config.fcm = {
	serviceAccount: {
		"type": "service_account",
		"project_id": "hamalert-b6e91",
		"private_key_id": "<redacted>",
		"private_key": "<redacted>",
		"client_email": "<redacted>",
		"client_id": "<redacted>",
		"auth_uri": "https://accounts.google.com/o/oauth2/auth",
		"token_uri": "https://oauth2.googleapis.com/token",
		"auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
		"client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-x9kti%40hamalert-b6e91.iam.gserviceaccount.com",
		"universe_domain": "googleapis.com"
	},
	databaseUrl: 'https://hamalert-b6e91.firebaseio.com'
};

config.rbn = [
	{
		server: {
			host: 'telnet.reversebeacon.net',
			port: 7000
		},
		/*server: {
			//host: 'f1oyp.no-ip.org',
			//port: 7300,
			//host: '185.73.168.155',
			//port: 23,
			//host: 'cluster.dl9gtb.de',
			//port: 8000,
			host: 'w3lpl.net',
			port: 7373,
			commands: [
				'set dx filter not skimbusted',
				'set dx ext'
			]
		},*/
		login: "HB9DQM-4",
		timeout: 180000
	},
	{
		// FT8 RBN
		server: {
			host: 'telnet.reversebeacon.net',
			port: 7001
		},
		login: "HB9DQM-4",
		timeout: 180000,

		// Quorum settings (optional)
		/*quorum: 3,	// how many different spotters must see a call/band/mode combination before spots are deemed valid
		quorumInterval: 15*60*1000,
		pruneInterval: 600000,
		maxAge: 900000*/
	}
];

config.cluster = [
	{
		source: 'cluster',
		servers: [
			{
				host: 'spider.ham-radio-deluxe.com',
				port: 8000
			},
			{
				host: 'spider.hb9on.net',
				port: 8000
			}
		],
		login: "HB9DQM-4",
		timeout: 300000,
		titlePrefix: "Cluster spot",
		filterRegex: /\b(nil)\b/i,
		spotterFilterRegex: /^W3LPL$/i,
		solardataTargetUrlBase: 'https://sotl.as/api/solardata',
		solardataApiKey: '<redacted>'
	},
	{
		source: 'wwff',
		servers: [
			{
				host: 'spots.wwff.co',
				port: 7300
			}
		],
		timeout: 300000,
		titlePrefix: 'WWFF',
		wwffMode: true
	}
];

config.pskreporter = {
	url: "https://stream.pskreporter.info/stream/report?token=<redacted>",
	timeout: 300000,
	maxAge: 900000,
	quorum: 3,	// how many different spotters must see a call/band/mode combination before spots are deemed valid
	quorumInterval: 15*60*1000,
	disabled: false,
	spotterFilterRegex: /^(([A-Z]{1,2}[0-9]?|[0-9][A-Z])\/)?([A-Z]{1,2}|[0-9][A-Z])[0-9]{1,2}[A-Z]{1,4}(\/(M|P|QRP|[0-9]))?(-[0-9])?$/i
};

config.simulator = {
	port: 1983,
	address: '127.0.0.1'
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
	{from: 430, to: 440, band: "70cm"},
	{from: 1200, to: 1400, band: "23cm"},
	{from: 2300, to: 2450, band: "13cm"},
	{from: 3300, to: 3500, band: "9cm"},
	{from: 5400, to: 5900, band: "6cm"},
	{from: 10489.550, to: 10490, band: "3cm_qo100"},
	{from: 10000, to: 10500, band: "3cm"}
];

config.bandRangesToBands = {
	"lf": ["2200m"],
	"mf": ["600m", "160m"],
	"hf": ["80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "11m", "10m"],
	"vhf": ["8m", "6m", "4m", "2m", "1.25m"],
	"uhf": ["70cm", "23cm", "13cm"],
	"shf": ["9cm", "6cm", "3cm_qo100", "3cm"]
};

config.crashNotifyMail = {
	transport: {
		host: 'email-smtp.eu-central-1.amazonaws.com',
		port: 587,
		auth: {
			user: "<redacted>",
			pass: "<redacted>"
		}
	},
	from: 'pm2@hamalert.org',
	to: 'mk@neon1.net'
};

config.userCache = {
	maxAge: 60000
};

config.matcher = {
	numProcesses: 6,
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
		'qsl'
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
		'qsl'
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
	commentPattern: /\b(psk\d*|rtty|jt65|jt9|msk\d*|ft4|ft8|js8call|qra64|iscat|fsk441|t10|sstv|varac|olivia|fst4)\b/i
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
