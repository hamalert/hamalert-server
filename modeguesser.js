const config = require('./config');

const fhRegex = /\bf\/h\b/i;

class ModeGuesser {
	guessMode(spot) {
		if (spot.mode)
			return undefined;
		
		// Attempt to extract mode from comment
		if (spot.comment) {
			let matches = config.modeguesser.commentPattern.exec(spot.comment);
			if (matches) {
				return matches[1].toLowerCase();
			} else {
				// Handle "F/H" (fox-and-hound) => FT8
				if (fhRegex.test(spot.comment)) {
					return "ft8";
				}
			}
		}
		
		// Attempt to find mode using band ranges
		for (let range of config.modeguesser.ranges) {
			if (range.from <= spot.frequency && range.to >= spot.frequency)
				return range.mode;
		}
		
		return undefined;
	}
}

module.exports = ModeGuesser;
