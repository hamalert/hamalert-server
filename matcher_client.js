const cp = require('child_process');
const exitHook = require('async-exit-hook');
const config = require('./config');

class MatcherClient {
	constructor() {
		// Fork new matcher child processes
		this.children = [];
		this.nextChild = 0;

		for (let i = 0; i < config.matcher.numProcesses; i++) {
			let child = cp.fork(`${__dirname}/matcher.js`);
			child.on('exit', (code) => {
				console.error(`Matcher child process ${i} exited with code ${code}`);
			});
			child.on('error', (err) => {
				console.error(`Matcher child process ${i} encountered error: ${err}`);
			});
			child.on('message', (m) => {
				this._processResult(m);
			});
			this.children.push(child);
		}
		
		exitHook(() => {
			this.children.forEach((child) => {
				child.kill();
			});
		});
		
		this.requestMap = new Map();
		this.nextReqId = 1;

		// Print number of pending results regularly
		setInterval(() => {
			console.log(`Pending matcher requests: ${this.requestMap.size}`);
		}, 10000);
	}
	
	match(query, callback) {
		let reqId = this.nextReqId++;
		this.requestMap.set(reqId, callback);
		
		try {
			// Dispatch to next child in round-robin fashion
			this.children[this.nextChild].send({id: reqId, query: query});
			this.nextChild++;
			if (this.nextChild >= this.children.length)
				this.nextChild = 0;
		} catch (e) {
			callback(e);
		}
	}
	
	_processResult(result) {
		let callback = this.requestMap.get(result.id);
		if (!callback) {
			console.error(`No callback found for request ID ${result.id}`);
			return;
		}
		this.requestMap.delete(result.id);
		
		if (result.error) {
			callback(new Error(result.error));
		} else {
			callback(null, result.matches);
		}
	}
}

module.exports = MatcherClient;
