const nodemailer = require('nodemailer');
const config = require('../config');
const Notifier = require('./notifier');
const expand = require('expand-template')();
const hamutil = require('../hamutil');

class EmailNotifier extends Notifier {
	constructor(fieldName) {
		super();
		this.fieldName = fieldName;
		this.transporter = nodemailer.createTransport(config.mail.transport);
	}
	
	notify(user, spot, comment) {
		if (user[this.fieldName]) {
			this.notifyEmail(spot, comment, user[this.fieldName]);
		}
	}
	
	notifyEmail(spot, comment, email) {
		let subject, body;
		let placeholders;
		
		// Only get placeholders if we need them
		if (email.subjectFormat || email.bodyFormat) {
			placeholders = hamutil.makeSpotParams(spot, comment);
		}
		
		if (email.subjectFormat) {
			if (email.subjectFormat === 'blank') {
				subject = '';
			} else {
				subject = expand(email.subjectFormat, placeholders);
			}
		} else {
			subject = spot.title;
		}
		
		if (email.bodyFormat) {
			body = expand(email.bodyFormat, placeholders);
		} else {
			body = spot.rawText;
			body += "\n\n" + this.printSpotDetails(spot);

			if (comment) {
				body += "\n\n" + "Trigger comment: " + comment.join(", ");
			}
		}
		
		let mail = {
			from: config.mail.from,
			to: email.address,
			subject: subject,
			text: body
		};
		
		this.transporter.sendMail(mail, function (error, info) {
			if (error)
				console.error(error);
		});
	}
	
	printSpotDetails(spot) {
		let text = '';
		
		text += `Call:          ${spot.fullCallsign}\n`;
		text += `Frequency:     ${hamutil.formatFrequency(spot.frequency)}\n`;
		text += `Mode:          ${spot.modeDetail}`;
		if (spot.modeIsGuessed)
			text += " (guessed)";
		text += "\n";
		text += `Time:          ${spot.time}\n`;
		text += `Source:        ${spot.source}\n`;

		if (spot.speed) {
			text += `Speed:         ${spot.speed} WPM\n`;
		}

		if (spot.snr) {
			text += `SNR:           ${spot.snr} dB\n`;
		}
		
		if (spot.dxcc) {
			text += `DXCC:          ${spot.dxcc.dxcc} - ${spot.dxcc.country}\n`;
			if (spot.dxcc.cq) {
				text += `CQ zone:       ${spot.dxcc.cq}\n`;
			}
		}

		if (spot.state) {
			let countryState = spot.state.split("_");
			text += `State:         ${countryState[1]}\n`;
		}

		if (spot.qsl) {
			text += `QSL:           ${spot.qsl.join(', ')}\n`;
		}

		text += "\n";
		text += `Spotter:       ${spot.spotter}\n`;
		if (spot.spotterDxcc) {
			text += `Spotter DXCC:  ${spot.spotterDxcc.dxcc} - ${spot.spotterDxcc.country}\n`;
			if (spot.spotterDxcc.cq) {
				text += `Spotter CQ:    ${spot.spotterDxcc.cq}\n`;
			}
		}

		if (spot.spotterState) {
			let countryState = spot.spotterState.split("_");
			text += `Spotter state: ${countryState[1]}\n`;
		}
		
		if (spot.summitRef) {
			text += "\n";
			text += `Summit ref:    ${spot.summitRef}\n`;
			if (spot.summitName) {
				text += `Summit name:   ${spot.summitName} (${spot.summitHeight}m, ${spot.summitPoints}pt)\n`;
			}
		}
		
		if (spot.wwffRef) {
			text += "\n";
			text += `Park ref:      ${spot.wwffRef}\n`;
			if (spot.wwffName) {
				text += `Park name:     ${spot.wwffName}\n`;
			}
		}
		
		if (spot.iotaGroupRef) {
			text += "\n";
			text += `IOTA ref:      ${spot.iotaGroupRef}\n`;
			if (spot.iotaGroupName) {
				text += `IOTA name:     ${spot.iotaGroupName}\n`;
			}
		}
		
		return text;
	}
}

module.exports = EmailNotifier;
