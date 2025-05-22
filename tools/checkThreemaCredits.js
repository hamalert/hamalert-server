const axios = require('axios')
const config = require('../config')

let credits = axios.get('https://msgapi.threema.ch/credits', {
	params: {
		from: config.threema.apiId,
		secret: config.threema.apiSecret
	}
}).then((response) => {
	if (response.data < config.threema.creditsWarningThreshold) {
		console.error(`Only ${response.data} Threema credits left`)
	}
})
