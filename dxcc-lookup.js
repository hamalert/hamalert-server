const PrefixTrie = require('./prefix-trie')
const xml2js = require('xml2js')
const axios = require('axios')
const { gunzip } = require('zlib')
const { promisify } = require('util')
const do_gunzip = promisify(gunzip)
const config = require('./config')

class DxccLookup {
	constructor() {
		this.entities = new Map()
		this.exceptions = new Map()
		this.invalidOperations = new Map()
		this.zoneExceptions = new Map()
		this.prefixTrie = new PrefixTrie()

		this._loadPrefixes()
		setInterval(() => {
			this._loadPrefixes()
		}, config.clublog.reloadInterval)
	}

	findPrefix(call) {
		if (typeof call !== 'string' || call.length === 0) {
			return undefined
		}

		let exception = this.exceptions.get(call)
		if (exception) {
			return exception
		}
		let invalid = this.invalidOperations.get(call)
		if (invalid) {
			return undefined
		}

		// Aeronautical/Maritime mobile does not qualify for DXCC
		if (call.endsWith('/AM') || call.endsWith('/MM')) {
			return undefined
		}

		// Special handling for KG4: KG4xx is Guantanamo, but KG4x/KG4xxx is USA
		if (call.startsWith('KG4') && call.length != 5) {
			call = 'K1AA'
		}

		let prefix = this.prefixTrie.getLongestMatch(call)
		if (prefix) {
			if (prefix.entity === 'INVALID') {
				return undefined
			}
			let zoneException = this.zoneExceptions.get(call)
			if (zoneException) {
				prefix = Object.assign({}, prefix)
				prefix.cqz = zoneException.zone
			}
		}
		return prefix
	}

	_loadPrefixes() {
		console.log('Loading DXCC prefix information from Club Log')
		let now = new Date()
		return axios.get('https://cdn.clublog.org/cty.php', {params: {api: config.clublog.apiKey}, responseType: 'arraybuffer'})
			.then(response => {
				return do_gunzip(response.data)
					.then(buf => {
						let xml = buf.toString('utf8')
						let parser = new xml2js.Parser({explicitArray: false})
						return parser.parseStringPromise(xml)
							.then(result => {
								let entities = new Map()
								result.clublog.entities.entity.forEach(entity => {
									delete entity.$
									entities.set(entity.adif, entity)
								})
								this.entities = entities

								let prefixTrie = new PrefixTrie()
								result.clublog.prefixes.prefix.forEach(prefix => {
									delete prefix.$
									if (prefix.start) {
										if (new Date(prefix.start) > now) {
											return
										}
									}
									if (prefix.end) {
										if (new Date(prefix.end) < now) {
											return
										}
									}
									prefixTrie.put(prefix.call, prefix)
								})
								this.prefixTrie = prefixTrie

								let exceptions = new Map()
								result.clublog.exceptions.exception.forEach(exception => {
									delete exception.$
									if (exception.start) {
										if (new Date(exception.start) > now) {
											return
										}
									}
									if (exception.end) {
										if (new Date(exception.end) < now) {
											return
										}
									}
									if (exceptions.has(exception.call)) {
										console.log(`Duplicate exception for ${exception.call}`)
									} else {
										exceptions.set(exception.call, exception)
									}
								})
								this.exceptions = exceptions

								let invalidOperations = new Map()
								result.clublog.invalid_operations.invalid.forEach(invalid => {
									delete invalid.$
									if (invalid.start) {
										if (new Date(invalid.start) > now) {
											return
										}
									}
									if (invalid.end) {
										if (new Date(invalid.end) < now) {
											return
										}
									}
									if (invalidOperations.has(invalid.call)) {
										console.log(`Duplicate invalid operation for ${invalid.call}`)
									} else {
										invalidOperations.set(invalid.call, invalid)
									}
								})
								this.invalidOperations = invalidOperations

								let zoneExceptions = new Map()
								result.clublog.zone_exceptions.zone_exception.forEach(zoneException => {
									delete zoneException.$
									if (zoneException.start) {
										if (new Date(zoneException.start) > now) {
											return
										}
									}
									if (zoneException.end) {
										if (new Date(zoneException.end) < now) {
											return
										}
									}
									if (zoneExceptions.has(zoneException.call)) {
										console.log(`Duplicate zone exception for ${zoneException.call}`)
									} else {
										zoneExceptions.set(zoneException.call, zoneException)
									}
								})
								this.zoneExceptions = zoneExceptions
							})
					})
			})
	}
}

let dxccLookup = new DxccLookup()

// This is a singleton for ease of use
module.exports = dxccLookup
