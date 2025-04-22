const EventEmitter = require('events');

class Notifier extends EventEmitter {
	notify() {
		//dummy to be overridden by subclasses
	}
}

module.exports = Notifier;
