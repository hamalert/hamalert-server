# Running HamAlert locally

One-command local dev environment for developing and testing spot sources. It runs MongoDB
and Redis in Docker, seeds a test user and two D-STAR triggers, and starts the server itself
against `config-local.js` — no production credentials needed at all. Push notifications
(APNS/FCM), Threema, and the RBN/cluster telnet feeds are left out; they need real credentials
or a real callsign login. If you also have a `hamalert-web` checkout with a `Dockerfile.dev`,
the web app is started too.

## Prerequisites

- Docker (daemon running; `docker info` should succeed). Podman with the `podman-docker` shim works too.
- Node.js 22
- Optionally, a `hamalert-web` checkout next to this repo (`../hamalert-web`) if you want the
  web UI — see `HAMALERT_WEB_DIR` below if it lives somewhere else.

## Run it

```sh
npm install
npm run local-dev
```

This:

1. Removes any leftover `hamalert-dev-*` containers from a previous run and creates the
   `hamalert-dev` Docker network.
2. Starts `mongo:7` on `127.0.0.1:27117` and `redis:7` on `127.0.0.1:6479` (non-default ports,
   so they don't clash with a MongoDB/Redis you already have running locally).
3. Waits for both to accept connections, then runs `tools/seedLocalUser.js` to create user
   `HB9DQM` (password `testpass123`) with two triggers (telnet and app actions): one for
   HB9DQM's own D-STAR callsign, one for anyone on reflector REF030. The app action makes the
   matched spots show up in the mobile app's feed (see the hamalert-app README for running the
   app in a desktop browser against this stack).
4. If `../hamalert-web/Dockerfile.dev` exists (or `HAMALERT_WEB_DIR` points at a checkout with
   one), builds and starts it on `127.0.0.1:8081`. Otherwise it prints a notice and continues
   without the web app.
5. Prints a banner (web URL and login, telnet command, a ready-made curl command to simulate a
   D-STAR spot).
6. Starts the server itself (`HAMALERT_CONFIG=config-local.js NODE_ENV=development node
   server.js`), attached to your terminal.

Stop it with Ctrl-C: the `hamalert-dev-mongo`/`-redis`/`-web` containers are removed
automatically (the `hamalert-dev` network is left in place so the next run is fast).

## Using it

- Telnet: `nc 127.0.0.1 7300`, login `HB9DQM` / `testpass123`.
- Simulate a spot (the banner prints the exact command with the real `user_id`):
  ```sh
  curl -X POST http://127.0.0.1:1983/sendSpot -H 'Content-Type: application/json' -d '{
    "user_id": "<user_id>", "source": "dstar", "fullCallsign": "HB9DQM", "mode": "dstar",
    "dvEvent": "active", "dvNode": "HB9DQM-B", "dvReflector": "REF030-C"
  }'
  ```
  Simulated spots only match the triggers of the given user. The telnet session shows a line
  like `DX de :               DV  HB9DQM       DV HB9DQM-B REF030-C           1227Z`.
- Live D-STAR spots from the real QuadNet/ircDDB feeds appear in the server log as
  `Spot: ... (dstar), from <gateway> via dstar` once someone transmits (usually within a
  minute or two). These are real network feeds; the ircDDB one may need a proxy on restricted
  networks (see `config-local.js`'s `dstar.ircddb.connectProxy`).
- The web app, if started, is at http://localhost:8081, same login. Its "Simulate" page posts
  to the simulator through `host.docker.internal`, so it works the same way as the curl above.

## Options

- `npm run local-dev -- --keep` — leave the containers running when the server exits, so the
  next run doesn't have to re-seed from scratch (data stays in the containers as long as they
  exist; `--down` still removes them).
- `npm run local-dev -- --no-web` — skip the web app container even if a checkout is found.
- `npm run local-dev:down` — stop and remove the dev containers, the `hamalert-dev` network and the
  `hamalert-dev-web-vendor` volume (it holds the web app's composer packages, so they are installed
  once rather than on every start and never touch your `hamalert-web` checkout).
- `npm run local-dev -- --dry-run` — print every Docker command and the banner without running
  anything or starting the server; useful to sanity-check what it would do.
- `HAMALERT_WEB_DIR=/path/to/hamalert-web npm run local-dev` — use a web checkout that isn't
  at `../hamalert-web`.
- `npm run seed-local` — re-run just the seeding step against the already-running containers.
- `npm run dstar-test` — standalone D-STAR feed tester (`tools/dstarTest.js`), no database
  needed; see its header comment for options (`--file`, `--connect-proxy`, etc).

### Pointing at a different config

Every module loads its config through `config_loader.js`, which requires `./config.js` by
default or, if set, the file named by `HAMALERT_CONFIG` (resolved relative to the current
directory). `npm run local-dev` sets `HAMALERT_CONFIG=config-local.js` when it starts the
server; you can do the same by hand for any other config file, e.g.
`HAMALERT_CONFIG=config-local.js node server.js`.

## Known gaps

- No push notifications: `config.apns`/`config.fcm` are absent from `config-local.js`, and
  `notify/app.js` skips those notifiers when they're absent.
- No Club Log lookups: `config.clublog.apiKey` is `null` locally, and `clublog.js` skips the
  HTTP call entirely in that case, so spots have no DXCC. Harmless.
- No RBN or cluster telnet feeds: `config.rbn`/`config.cluster` are empty arrays locally, since
  those feeds need a real callsign login.
- Threema, mail and crash-notify mail are configured with obvious placeholder credentials and
  are not exercised by this setup.
