// Loads ./config.js by default, or the file named by HAMALERT_CONFIG (used by `npm run local-dev`)
const path = require('path');
module.exports = require(process.env.HAMALERT_CONFIG ? path.resolve(process.env.HAMALERT_CONFIG) : path.join(__dirname, 'config'));
