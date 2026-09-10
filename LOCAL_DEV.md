# Running HamAlert locally

This is a minimal local setup for developing and testing spot sources (written while adding
the D-STAR source). It runs the server, the matcher, the telnet notifier and the web app
against a local MongoDB and Redis. Push notifications (APNS/FCM) and Threema are left out;
they need real credentials.

There is no in-memory mode: MongoDB holds users, triggers and spots, and the matcher
processes read triggers straight from it. Redis is only used for the per-user spot stream
that the app reads, but the server opens it at startup.

## 1. Prerequisites

- Node.js 22, PHP 8 with Composer and the `mongodb` PHP extension (`php -m | grep mongodb`)
- Docker (or local MongoDB and Redis installs)

```sh
docker run -d --name hamalert-mongo -p 27017:27017 mongo:7
docker run -d --name hamalert-redis -p 6379:6379 redis:7
```

## 2. Server

```sh
cd hamalert-server
npm install
cp config_clean.js config.js
mkdir -p /tmp/hamalert-cache
```

Edit `config.js`:

| Setting | Value |
|---|---|
| `config.mongodb.url` | `mongodb://127.0.0.1:27017/hamalert` |
| `config.rateLimit.dumpFile`, `config.clublog.dumpFile` | files under `/tmp/hamalert-cache/` |
| `config.pskreporter.disabled` | `true` (needs a token) |
| `config.rbn[*].login`, `config.cluster[*].login` | your own callsign, not the production one |
| `config.matcher.numProcesses` | `1` |
| `config.apns`, `config.fcm` | delete both blocks; the app notifier is skipped when they are absent |
| `config.dstar.ircddb.connectProxy` | leave commented out unless you are behind an HTTP CONNECT proxy |

Seed a user and two D-STAR triggers, then start the server:

```sh
node tools/seedLocalUser.js        # prints the user_id and a ready-made curl command
NODE_ENV=development node server.js 2>&1 | tee server.log
```

Wait for `Loaded 2 (0) triggers`, `D-STAR QuadNet feed primed` and `D-STAR ircDDB feed primed`.
Live D-STAR spots appear as `Spot: ... (dstar), from <gateway> via dstar` within a minute or two.

## 3. Receive alerts over telnet

```sh
nc 127.0.0.1 7300
# login: HB9DQM   password: testpass123
```

Then send a simulated D-STAR spot (use the `user_id` printed by the seed script):

```sh
curl -X POST http://127.0.0.1:1983/sendSpot -H 'Content-Type: application/json' -d '{
  "user_id": "<user_id>", "source": "dstar", "fullCallsign": "HB9DQM", "mode": "dstar",
  "dvEvent": "active", "dvNode": "HB9DQM-B", "dvReflector": "REF030-C"
}'
```

The telnet session shows a line like

```
DX de :               DV  HB9DQM       DV HB9DQM-B REF030-C           1227Z
```

and the spot is written to the `spots` collection and to the Redis stream `spots:<user_id>`.
Simulated spots only match the triggers of the given user.

## 4. Web app

```sh
cd hamalert-web
composer install
cp config_clean.inc.php config.inc.php
```

Edit `config.inc.php`: `mongodb_uri` to `mongodb://127.0.0.1:27017/hamalert`, `self_url` to
`http://127.0.0.1:8081`, and `simulate_spot_url` to `http://127.0.0.1:1983/sendSpot`.

```sh
php -S 127.0.0.1:8081 tools/router.php
```

The router replaces the `.htaccess` rewrite (extensionless URLs such as `/triggers` and
`/ajax/trigger_update`) for PHP's built-in server. Log in at http://127.0.0.1:8081/login with
the seeded user, edit triggers, and use the Simulate page to send spots. Trigger changes take
up to `config.matcher.reloadInterval` (60 s) to reach the matcher.

If your PHP `mongodb` extension is 2.x, the pinned `mongodb/mongodb` 1.x library is not
compatible with it. Either install a 1.x extension or, locally only, run
`composer update mongodb/mongodb` with the constraint widened to `^1.0.0 || ^2.0`.

## Known gaps

- RBN, cluster and WWFF telnet feeds reconnect in a loop if outbound TCP is blocked.
- Club Log lookups fail without an API key; spots then have no DXCC, which is harmless.
- APNS, FCM, Threema and URL notifiers are not exercised by this setup.
