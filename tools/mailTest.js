const nodemailer = require('nodemailer')
const config = require('../config')

let mail = {
	from: 'do-not-reply@hamalert.org',
	to: 'mk@neon1.net',
	subject: 'HamAlert test message',
	text: `Dear HamAlert user,

This is a test message.

vy 73,

The HamAlert team
`
}

let transporter = nodemailer.createTransport(config.mail.transport)
transporter.sendMail(mail)
