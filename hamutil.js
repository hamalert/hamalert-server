const sprintf = require('sprintf-js').sprintf;

exports.formatFrequency = function(frequency) {
	try {
		return sprintf("%.06f", frequency).replace(/^(\d+\.\d{3,}?)0+$/, '$1');
	} catch (e) {
		console.error(`Cannot format frequency "${frequency}": ${e}`);
		return frequency;
	}
}

exports.extractCanonicalCallsign = function(fullCallsign) {
	if (fullCallsign === null) {
		return null;
	}

	// extract canonical callsign (without prefix/suffix)
	let callsignParts = fullCallsign.split("/");
	if (callsignParts.length == 1) {
		// no prefix/suffix
		return callsignParts[0];
	} else if (callsignParts.length == 2) {
		// prefix or suffix - assume callsign is the longer part
		if (callsignParts[0].length > callsignParts[1].length) {
			return callsignParts[0];
		} else {
			return callsignParts[1];
		}
	} else {
		// both prefix and suffix - assume second part is callsign
		return callsignParts[1];
	}
}

exports.makeSpotParams = function(spot, comment) {
	let params = {
		fullCallsign: spot.fullCallsign,
		callsign: spot.callsign,
		frequency: exports.formatFrequency(spot.frequency),
		band: spot.band,
		mode: spot.mode,
		modeDetail: spot.modeDetail,
		time: spot.time,
		spotter: spot.spotter,
		snr: spot.snr,
		speed: spot.speed,
		rawText: spot.rawText,
		title: spot.title,
		comment: spot.comment,
		source: spot.source,
		state: spot.state,
		spotterState: spot.spotterState,
		summitName: spot.summitName,
		summitHeight: spot.summitHeight,
		summitPoints: spot.summitPoints,
		summitRef: spot.summitRef,
		wwffRef: spot.wwffRef,
		wwffDivision: spot.wwffDivision,
		wwffName: spot.wwffName,
		iotaGroupRef: spot.iotaGroupRef,
		iotaGroupName: spot.iotaGroupName
	};
	
	if (spot.qsl) {
		params.qsl = spot.qsl.join(',');
	}
	
	if (spot.dxcc) {
		params.dxcc = spot.dxcc.dxcc;
		params.entity = spot.dxcc.country;
		if (spot.dxcc.cq) {
			params.cq = spot.dxcc.cq.join(',');
		}
		if (spot.dxcc.continent) {
			params.continent = spot.dxcc.continent.join(',');
		}
	}
	
	if (spot.callsignDxcc) {
		params.homeDxcc = spot.callsignDxcc.dxcc;
		params.homeEntity = spot.callsignDxcc.country;
	}
	
	if (spot.spotterDxcc) {
		params.spotterDxcc = spot.spotterDxcc.dxcc;
		params.spotterEntity = spot.spotterDxcc.country;
		if (spot.spotterDxcc.cq) {
			params.spotterCq = spot.spotterDxcc.cq.join(',');
		}
		if (spot.spotterDxcc.continent) {
			params.spotterContinent = spot.spotterDxcc.continent.join(',');
		}
	}
	
	if (comment) {
		params.triggerComment = comment.join(', ');
	}
	
	return params;
}
