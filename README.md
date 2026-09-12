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
spot per callsign, event type and place per `config.dstar.dedupeInterval`, where the place is the
reflector callsign (without module) if there is one, else the repeater node. This collapses the
same transmission reported by several feeds (or on a bare reflector and a reflector module) into
one alert. A third
source, dstarusers.org (see below), covers REF/XRF/DCS/XLX reflector activity that QuadNet and
ircDDB never see.

Spots have `source: 'dstar'`, `mode: 'dstar'`, and the fields `dvEvent` (`active` or `linked`),
`dvNode` (e.g. `W4HFH-C`) and `dvReflector` (e.g. `REF030-C`). The matcher accepts
`dvNode`/`dvReflector` conditions with or without the module letter.

`dstar.js` itself carries no frequency; `server.js` resolves frequency/band from the QuadNet
(`openquad.net`) and ircDDB (`status.ircddb.net`) repeater lists (`dstar_nodes.js`), keyed by
repeater module. If a node is not listed in either list, the band is guessed from the module
letter convention (A = 23cm, B = 70cm, C = 2m) and flagged with `bandIsGuessed: true`;
otherwise (an unknown module letter, or no module at all) `band` is set to `"unknown"`.

### dstarusers.org feed

`dstar.js` also polls `https://www.dstarusers.org/lastheard.php` every 30s (`config.dstar.dstarusers`),
a static HTML "last heard" page kept up to date by DStarMonitor agents running on DPlus/DExtra
REF/XRF/DCS/XLX reflectors and on Icom repeater gateways. This is the only source of REF
reflector traffic; QuadNet and ircDDB only see repeater/hotspot activity, with zero overlap
measured against dstarusers.org. Each row is diffed against a watermark of previously-seen rows
(the page has no offset/line-number mechanism) and maps straight to a single `active` event; the
first poll only primes this watermark and emits nothing.

A row naming a bare reflector with no module (e.g. `REF030`) is a hotspot/dongle user reported
by the reflector itself, which has no way to know which module they're on; it becomes a spot
with `dvReflector` but no `dvNode` at all. So that these aren't missed, `runMatcher()` expands a
module-less `dvReflector` condition to match every module (`REF030`, `REF030-A` .. `REF030-E`),
meaning a module-specific trigger like `REF030-C` also fires for them.

Test without a database: `node tools/dstarTest.js` (live feeds), `node tools/dstarTest.js --file
<saved QuadNet/ircDDB log>`, or `node tools/dstarTest.js --dstarusers-file <saved lastheard.php
page>` (e.g. `tools/fixtures/dstarusers-lastheard.html`).

Test the node directory lookup on its own (also no database needed): `node
tools/dstarNodeTest.js <node> [<node> ...]`, e.g. `node tools/dstarNodeTest.js 2E0CMS-B
W4HFH-C ZZ9ZZZ-C`.
