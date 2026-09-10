/*
	One-command local development environment for the HamAlert server (see LOCAL_DEV.md).

	Starts MongoDB and Redis (and, if a hamalert-web checkout is found, the web app) in Docker
	containers, seeds a test user and two D-STAR triggers, then runs the server itself against
	config-local.js (via HAMALERT_CONFIG). On exit the containers are torn down again unless
	--keep is given.

	Usage: node tools/localDev.js [--keep] [--no-web] [--dry-run]
	       node tools/localDev.js --down

	No new npm dependencies: containers are driven with plain `docker` subprocesses, and the
	server's own "mongodb" dependency is reused to wait for MongoDB to accept connections.
*/
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { MongoClient } = require('mongodb');

const repoRoot = path.resolve(__dirname, '..');

const NETWORK = 'hamalert-dev';
const MONGO_CONTAINER = 'hamalert-dev-mongo';
const REDIS_CONTAINER = 'hamalert-dev-redis';
const WEB_CONTAINER = 'hamalert-dev-web';

const MONGO_HOST_PORT = 27117;
const REDIS_HOST_PORT = 6479;
const WEB_HOST_PORT = 8081;

const MONGO_URL = `mongodb://127.0.0.1:${MONGO_HOST_PORT}/hamalert`;

function log(msg) {
	console.log(`[local-dev] ${msg}`);
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Quote an argv element for display only (the actual commands are run without a shell)
function quoteForDisplay(arg) {
	return /[\s"'$]/.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg;
}

function formatCommand(cmd, args) {
	return [cmd].concat(args).map(quoteForDisplay).join(' ');
}

// Run a docker (sub)command. In --dry-run mode this only prints what would run.
// Returns the spawnSync result ({status, stdout, stderr}); status is 0 in dry-run mode.
function runDocker(args, opts) {
	opts = opts || {};
	if (opts.dryRun) {
		log(`$ ${formatCommand('docker', args)}`);
		return {status: 0, stdout: '', stderr: ''};
	}
	let res = spawnSync('docker', args, {
		stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		encoding: 'utf8'
	});
	if (res.error) {
		throw res.error;
	}
	if (res.status !== 0 && !opts.ignoreError) {
		let detail = opts.capture ? (res.stderr || res.stdout || '') : '';
		throw new Error(`docker ${args[0]} failed (exit ${res.status})${detail ? ': ' + detail.trim() : ''}`);
	}
	return res;
}

function checkDockerAvailable() {
	let res = spawnSync('docker', ['info'], {stdio: 'ignore'});
	if (res.error || res.status !== 0) {
		console.error('Docker does not seem to be available (is the daemon running? try `docker info`).');
		console.error('Local dev mode needs Docker for MongoDB, Redis and (optionally) the web app.');
		process.exit(1);
	}
}

function removeContainers(dryRun) {
	for (let name of [MONGO_CONTAINER, REDIS_CONTAINER, WEB_CONTAINER]) {
		runDocker(['rm', '-f', name], {dryRun, ignoreError: true, capture: true});
	}
}

function ensureNetwork(dryRun) {
	if (dryRun) {
		runDocker(['network', 'create', NETWORK], {dryRun});
		return;
	}
	let inspect = spawnSync('docker', ['network', 'inspect', NETWORK], {stdio: 'ignore'});
	if (inspect.status !== 0) {
		runDocker(['network', 'create', NETWORK], {capture: true});
	}
}

function removeNetwork(dryRun) {
	// Only used by --down; the network is otherwise left in place between runs.
	runDocker(['network', 'rm', NETWORK], {dryRun, ignoreError: true, capture: true});
}

async function waitForMongo(url, timeoutMs) {
	let deadline = Date.now() + timeoutMs;
	let lastErr;
	while (Date.now() < deadline) {
		let client = new MongoClient(url, {serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000});
		try {
			await client.connect();
			await client.db().command({ping: 1});
			await client.close();
			return;
		} catch (e) {
			lastErr = e;
			await client.close().catch(() => {});
			await sleep(1000);
		}
	}
	throw new Error(`Timed out waiting for MongoDB at ${url}: ${lastErr}`);
}

function waitForRedis(host, port, timeoutMs) {
	let deadline = Date.now() + timeoutMs;
	return new Promise((resolve, reject) => {
		function attempt() {
			let done = false;
			let socket = net.createConnection({host, port});
			let data = '';

			let finish = (err) => {
				if (done) {
					return;
				}
				done = true;
				socket.removeAllListeners();
				socket.destroy();
				if (err) {
					retry(err);
				} else {
					resolve();
				}
			};

			socket.setTimeout(2000);
			socket.on('connect', () => socket.write('PING\r\n'));
			socket.on('data', chunk => {
				data += chunk.toString();
				if (data.includes('+PONG')) {
					finish(null);
				}
			});
			socket.on('error', err => finish(err));
			socket.on('timeout', () => finish(new Error('timeout')));
		}

		function retry(lastErr) {
			if (Date.now() >= deadline) {
				reject(new Error(`Timed out waiting for Redis at ${host}:${port}: ${lastErr}`));
				return;
			}
			setTimeout(attempt, 1000);
		}

		attempt();
	});
}

function seedLocalUser(dryRun) {
	if (dryRun) {
		log(`$ MONGO_URL=${MONGO_URL} ${formatCommand(process.execPath, [path.join('tools', 'seedLocalUser.js')])}`);
		return '<user_id>';
	}

	let res = spawnSync(process.execPath, [path.join(__dirname, 'seedLocalUser.js')], {
		env: Object.assign({}, process.env, {MONGO_URL}),
		encoding: 'utf8'
	});
	process.stdout.write(res.stdout || '');
	process.stderr.write(res.stderr || '');
	if (res.status !== 0) {
		throw new Error('tools/seedLocalUser.js failed');
	}

	let match = /^USER_ID=(\S+)$/m.exec(res.stdout || '');
	if (!match) {
		throw new Error('tools/seedLocalUser.js did not print a USER_ID line');
	}
	return match[1];
}

// Build and start the web app container, if a hamalert-web checkout with a dev Dockerfile is found.
// Returns true if the web container was started. docker build needs a cwd override that the
// generic runDocker() wrapper doesn't take, so the build step is run directly with spawnSync.
function buildAndRunWebApp(dryRun) {
	let webDir = process.env.HAMALERT_WEB_DIR || path.resolve(repoRoot, '..', 'hamalert-web');
	let dockerfileDev = path.join(webDir, 'Dockerfile.dev');

	if (!dryRun && !fs.existsSync(dockerfileDev)) {
		log(`No web app checkout with a dev Dockerfile found at ${dockerfileDev}, skipping it.`);
		log('To include the web app, clone hamalert-web next to this repo (or set HAMALERT_WEB_DIR=<path>) with a Dockerfile.dev, or pass --no-web to silence this.');
		return false;
	}

	let buildArgs = ['build', '-t', 'hamalert-web-dev', '-f', 'Dockerfile.dev', '.'];
	if (dryRun) {
		log(`(in ${webDir})`);
		runDocker(buildArgs, {dryRun});
	} else {
		let res = spawnSync('docker', buildArgs, {cwd: webDir, stdio: 'inherit'});
		if (res.error || res.status !== 0) {
			throw new Error(`docker build for the web app failed (exit ${res.status})`);
		}
	}

	let runArgs = [
		'run', '-d', '--name', WEB_CONTAINER,
		'--network', NETWORK,
		'-p', `127.0.0.1:${WEB_HOST_PORT}:80`,
		'--add-host=host.docker.internal:host-gateway',
		'-v', `${webDir}:/var/www/html`,
		'-e', `MONGODB_URI=mongodb://${MONGO_CONTAINER}:27017/hamalert`,
		'-e', `SELF_URL=http://localhost:${WEB_HOST_PORT}`,
		'-e', `SIMULATE_SPOT_URL=http://host.docker.internal:1983/sendSpot`,
		'hamalert-web-dev'
	];
	runDocker(runArgs, {dryRun, capture: true});
	return true;
}

function printBanner({userId, webStarted, dryRun}) {
	let curl = `curl -X POST http://127.0.0.1:1983/sendSpot -H 'Content-Type: application/json' -d '{"user_id":"${userId}","source":"dstar","fullCallsign":"HB9DQM","mode":"dstar","dvEvent":"active","dvNode":"HB9DQM-B","dvReflector":"REF030-C"}'`;

	console.log('');
	console.log('============================================================');
	console.log(' HamAlert local dev environment' + (dryRun ? ' (dry run)' : ' is up'));
	console.log('============================================================');
	if (webStarted) {
		console.log(` Web app:   http://localhost:${WEB_HOST_PORT}  (login: HB9DQM / testpass123)`);
	} else {
		console.log(' Web app:   not started (see notice above; use --no-web to silence it)');
	}
	console.log(` Telnet:    nc 127.0.0.1 7300  (login: HB9DQM / testpass123)`);
	console.log('');
	console.log(' Simulate a D-STAR spot for the seeded user:');
	console.log(`   ${curl}`);
	console.log('');
	console.log(' Live D-STAR spots from the QuadNet/ircDDB feeds appear in the server log as');
	console.log(' "... via dstar" within a minute or two of someone transmitting.');
	console.log('============================================================');
	console.log('');
}

async function down(dryRun) {
	if (!dryRun) {
		checkDockerAvailable();
	}
	log('Stopping and removing dev containers and network...');
	removeContainers(dryRun);
	removeNetwork(dryRun);
	log('Done.');
}

async function up({keep, noWeb, dryRun}) {
	if (!dryRun) {
		checkDockerAvailable();
	}

	log('Removing any existing dev containers...');
	removeContainers(dryRun);

	log(`Ensuring docker network "${NETWORK}" exists...`);
	ensureNetwork(dryRun);

	log('Starting MongoDB...');
	runDocker(['run', '-d', '--name', MONGO_CONTAINER, '--network', NETWORK, '-p', `127.0.0.1:${MONGO_HOST_PORT}:27017`, 'docker.io/library/mongo:7'], {dryRun, capture: true});

	log('Starting Redis...');
	runDocker(['run', '-d', '--name', REDIS_CONTAINER, '--network', NETWORK, '-p', `127.0.0.1:${REDIS_HOST_PORT}:6379`, 'docker.io/library/redis:7'], {dryRun, capture: true});

	let cacheDir = path.join(repoRoot, '.local', 'cache');
	if (dryRun) {
		log(`$ mkdir -p ${cacheDir}`);
	} else {
		fs.mkdirSync(cacheDir, {recursive: true});
	}

	if (!dryRun) {
		log(`Waiting for MongoDB on 127.0.0.1:${MONGO_HOST_PORT}...`);
		await waitForMongo(MONGO_URL, 60000);
		log(`Waiting for Redis on 127.0.0.1:${REDIS_HOST_PORT}...`);
		await waitForRedis('127.0.0.1', REDIS_HOST_PORT, 60000);
	} else {
		log('[dry-run] would wait for MongoDB and Redis to accept connections');
	}

	log('Seeding local test user and triggers...');
	let userId = seedLocalUser(dryRun);

	let webStarted = false;
	if (!noWeb) {
		webStarted = buildAndRunWebApp(dryRun);
	} else {
		log('Skipping the web app (--no-web).');
	}

	printBanner({userId, webStarted, dryRun});

	if (dryRun) {
		log('Dry run complete, not starting the server.');
		return;
	}

	log('Starting the server (HAMALERT_CONFIG=config-local.js)...');
	let server = spawn(process.execPath, ['server.js'], {
		cwd: repoRoot,
		env: Object.assign({}, process.env, {HAMALERT_CONFIG: 'config-local.js', NODE_ENV: 'development'}),
		stdio: 'inherit'
	});

	let cleaningUp = false;
	let cleanup = (exitCode) => {
		if (cleaningUp) {
			return;
		}
		cleaningUp = true;

		if (keep) {
			log('--keep given, leaving containers running.');
			process.exit(exitCode);
			return;
		}

		log('Stopping dev containers (network is left in place; use --down to remove it too)...');
		try {
			removeContainers(false);
		} catch (e) {
			console.error(`[local-dev] failed to remove containers: ${e.message}`);
		}
		process.exit(exitCode);
	};

	server.on('exit', (code, signal) => {
		cleanup(signal ? 1 : (code === null ? 1 : code));
	});

	for (let sig of ['SIGINT', 'SIGTERM']) {
		process.on(sig, () => {
			log(`Received ${sig}, shutting down...`);
			if (!server.killed) {
				server.kill(sig);
			}
			// server's 'exit' handler above performs the actual cleanup/exit
		});
	}
}

function parseArgs(argv) {
	let opts = {down: false, keep: false, noWeb: false, dryRun: false};
	for (let arg of argv) {
		switch (arg) {
			case '--down':
				opts.down = true;
				break;
			case '--keep':
				opts.keep = true;
				break;
			case '--no-web':
				opts.noWeb = true;
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			default:
				console.error(`Unknown argument: ${arg}`);
				process.exit(1);
		}
	}
	return opts;
}

async function main() {
	let opts = parseArgs(process.argv.slice(2));

	if (opts.down) {
		await down(opts.dryRun);
		return;
	}

	await up(opts);
}

main().catch(e => {
	console.error(`[local-dev] ${e.stack || e}`);
	process.exit(1);
});
