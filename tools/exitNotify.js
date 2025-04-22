const nodemailer = require('nodemailer');
const config = require('../config');
const pm2 = require('pm2');
const fs = require('fs');

var errlines = 50;

pm2.connect(function() {
	pm2.launchBus(function(err, bus) {
		bus.on('process:event', function(data) {
			if (data.event === "exit") {
				try {
					notifyExit(data);
				} catch(e) {
					console.error(e);
				}
			}
		});
	});
});

function notifyExit(data) {
	let transporter = nodemailer.createTransport(config.mail.transport);
	
	let body = `The PM2 process "${data.process.name}" exited. Last ${errlines} lines from error log:\n\n`;
	
	let errorLog = fs.readFileSync(data.process.pm_err_log_path, "utf8");
	let errorLines = errorLog.split("\n");
	
	body += errorLines.slice(-errlines).join("\n");
	
	let mail = {
		from: config.crashNotifyMail.from,
		to: config.crashNotifyMail.to,
		subject: "PM2 process \"" + data.process.name + "\" exited",
		text: body
	};
	
	transporter.sendMail(mail, function (error, info) {
		if (error)
			console.error(error);
	});
}
