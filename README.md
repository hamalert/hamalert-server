# HamAlert server

This is the source code for the HamAlert server, the backend that processes spots from various sources, matches them against the triggers that the users have defined, and sends out notifications through various channels.

It is a Node.js application which spawns separate matcher processes (via IPC) to spread out the matching workload across multiple cores. Currently it is designed to run on a single server only as that is more than sufficient to handle the workload and foreseeable user growth.

## Running locally

`npm run local-dev` starts a complete local stack in Docker (or Podman with the `podman-docker`
shim): MongoDB, Redis, the web app (if a `hamalert-web` checkout sits next to this repo) and
the server itself, using the credential-free `config-local.js`. It seeds a test user
(`HB9DQM` / `testpass123`) with two D-STAR triggers and prints how to connect over telnet, how
to simulate a spot, and where the web app is. Ctrl-C tears everything down.

```sh
npm install
npm run local-dev
```

See [LOCAL_DEV.md](LOCAL_DEV.md) for the options (`--keep`, `--no-web`, `--down`), how config
selection works (`HAMALERT_CONFIG`), and the known gaps (no push notifications, no Club Log,
no RBN/cluster feeds). The web app can also be built and run on its own; see its README.

## D-STAR presence source

`dstar.js` is a presence source rather than a spot source: it reports when a callsign becomes
active on, or links to, a D-STAR repeater module or reflector module. It tails the public
"last heard" logs of QuadNet (`openquad.net`) and ircDDB (`live.ircddb.net`), classifies each
transmission (voice vs. link command; info/echo/unlink commands are ignored) and emits one
spot per callsign, node, reflector and event type per `config.dstar.dedupeInterval`.

Spots have `source: 'dstar'`, `mode: 'dstar'`, no frequency, and the fields `dvEvent`
(`active` or `linked`), `dvNode` (e.g. `W4HFH-C`) and `dvReflector` (e.g. `REF030-C`). The
matcher accepts `dvNode`/`dvReflector` conditions with or without the module letter.

Test without a database: `node tools/dstarTest.js` (live feeds) or
`node tools/dstarTest.js --file <saved log>`.
