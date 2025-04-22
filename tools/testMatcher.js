const MatcherClient = require('../matcher_client');
const util = require('util');

let matcherClient = new MatcherClient();

for (let i = 1; i < 600; i++) {
	matcherClient.match({dxcc: i}, (error, result) => {
		if (error) {
			console.error(`Got error: ${error}`);
			return;
		}
	
		console.log(`Result ${i}: ` + util.inspect(result, {depth: null}));
	});
}