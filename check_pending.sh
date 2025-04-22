#!/bin/sh

PENDING_COUNT=`grep Pending /home/hamalert/.pm2/logs/hamalert-out.log | tail -n 1 | cut -d " " -f 4`
if [ "$PENDING_COUNT" = "" ]; then
	exit
fi

if [ "$PENDING_COUNT" -ge 10000 ]; then
	echo "Subject: HamAlert pending matches count exceeded ($PENDING_COUNT)" | /usr/sbin/sendmail -f info@hamalert.org mk@neon1.net
fi
