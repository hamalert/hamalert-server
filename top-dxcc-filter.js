const axios = require('axios')
const dxccLookup = require('./dxcc-lookup')
const config = require('./config')

class TopDxccFilter {
	constructor(topDxccsToIgnore) {
		this.dxccsToIgnore = new Set()
		this.dataLoaded = false
		this.topDxccsToIgnore = topDxccsToIgnore

		this._loadDxccsToIgnore()
		setInterval(() => {
			this._loadDxccsToIgnore()
		}, config.clublog.reloadInterval)
	}

	shouldIgnoreDxcc(call) {
		if (!this.dataLoaded) {
			return true
		}
		
		if (this.dxccsToIgnore.size == 0) {
			return false
		}

		let prefix = dxccLookup.findPrefix(call)
		if (!prefix) {
			console.info(`No prefix found for ${call}`)
			return false
		}

		return this.dxccsToIgnore.has(prefix.adif)
	}

	_loadDxccsToIgnore() {
		console.log('Loading most wanted list from Club Log')
		return axios.get('https://clublog.org/mostwanted.php?api=1')
			.then(response => {
				let mostWanted = []
				for (let [key, value] of Object.entries(response.data)) {
					mostWanted[key] = value
				}
				let dxccsToIgnore = new Set()
				mostWanted.slice(-this.topDxccsToIgnore).forEach(adif => {
					dxccsToIgnore.add(adif)
				})
				this.dxccsToIgnore = dxccsToIgnore
				this.dataLoaded = true
			})
			.catch(error => {
				console.error(`Loading most wanted list failed: ${error}`)
			})
	}
}

module.exports = TopDxccFilter
