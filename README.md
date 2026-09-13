# HamAlert server

This is the source code for the HamAlert server, the backend that processes spots from various sources, matches them against the triggers that the users have defined, and sends out notifications through various channels.

It is a Node.js application which spawns separate matcher processes (via IPC) to spread out the matching workload across multiple cores. Currently it is designed to run on a single server only as that is more than sufficient to handle the workload and foreseeable user growth.

## Running locally

`npm run local-dev` starts a complete local stack in Docker (or Podman with the `podman-docker`
shim): MongoDB, Redis, the web app (if a `hamalert-web` checkout sits next to this repo) and
the server itself, using the credential-free `config-local.js`. It seeds a test user
(`HB9DQM` / `testpass123`) with two D-STAR triggers (`DSTAR_CATCHALL=1` adds a catch-all for every D-STAR spot) and prints how to connect over telnet, how
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
same transmission reported by several feeds into one alert. A third
source, dstarusers.org (see below), covers REF/XRF/DCS/XLX reflector activity that QuadNet and
ircDDB never see.

Spots have `mode: 'dstar'` and `source` set to the name of the feed that reported them
(`quadnet`, `ircddb` or `dstarusers`), plus the fields `dvEvent` (`active` or `linked`),
`dvNode` (e.g. `W4HFH-C`) and `dvReflector` (e.g. `REF030-C`). The matcher accepts
`dvNode`/`dvReflector` conditions with or without the module letter. A trigger with no `source`
condition matches D-STAR spots from any of the three feeds; use `mode: 'dstar'` (or leave source
unset) rather than a specific feed name to match D-STAR generally.

`dstar.js`'s `DstarReceiver.enrichSpot()` resolves spotter and frequency/band before a spot leaves
the module, from the QuadNet (`openquad.net`) and ircDDB (`status.ircddb.net`) repeater lists
(`dstar_nodes.js`), keyed by repeater module. If a node is not listed in either list, the band is
guessed from the module letter convention (A = 23cm, B = 70cm, C = 2m) and flagged with
`bandIsGuessed: true`; otherwise (an unknown module letter, or no module at all) `band` is set to
`"unknown"`.

### dstarusers.org feed

`dstar.js` also polls `https://www.dstarusers.org/lastheard.php` every 30s (`config.dstar.dstarusers`),
a static HTML "last heard" page kept up to date by DStarMonitor agents running on DPlus/DExtra
REF/XRF/DCS/XLX reflectors and on Icom repeater gateways. This is the only source of REF
reflector traffic; QuadNet and ircDDB only see repeater/hotspot activity, with zero overlap
measured against dstarusers.org. Each row is diffed against a watermark of previously-seen rows
(the page has no offset/line-number mechanism) and maps straight to a single `active` event; the
first poll only primes this watermark and emits nothing.

A row naming a bare reflector or gateway with no module (e.g. `REF030 Dongle User`) is a
DPlus/dongle/hotspot login, not a transmission - the reflector has no way to know which module a
merely-listening user is on. These rows are dropped entirely and produce no spot; when such a
user actually transmits, a proper module row follows (e.g. `REF030 C ...`) and is reported as
usual. So only reflector-module rows (`REF030 C 2 Meters` -> `dvReflector: 'REF030-C'`, no
`dvNode`) and repeater rows (`NS9RC B 440 MHz` -> `dvNode: 'NS9RC-B'`, band from the text) ever
become spots.

Test without a database: `node tools/dstarTest.js` (live feeds), `node tools/dstarTest.js --file
<saved QuadNet/ircDDB log>`, or `node tools/dstarTest.js --dstarusers-file <saved lastheard.php
page>` (e.g. `tools/fixtures/dstarusers-lastheard.html`).

Test the node directory lookup on its own (also no database needed): `node
tools/dstarNodeTest.js <node> [<node> ...]`, e.g. `node tools/dstarNodeTest.js 2E0CMS-B
W4HFH-C ZZ9ZZZ-C`.

### Reflector link directory

Many D-STAR "heard" reports (both dstarusers.org repeater rows and QuadNet/ircDDB records with
a blank destination) only name the repeater/hotspot module a callsign was heard on (e.g.
`GB7ME-B`), even though that module is itself linked to a DPlus REF reflector module (e.g.
`GB7ME B` linked to `REF030 C`). Without knowing that link, a trigger on the reflector
(`REF030`) would never fire. `dstar_links.js`'s `ReflectorLinkDirectory` fills this gap by
periodically scraping each watched REF reflector's own "Linked Gateways" dashboard and building
a `node -> reflector` map; `dstar.js`'s `DstarReceiver` consults it (synchronously, a plain Map
lookup) whenever an event has a node but no reflector of its own, filling in `dvReflector` and
`dvReflectorSource: 'dashboard'` before the spot is built and deduplicated - so e.g. "M3LEE heard
on GB7ME-B" becomes "M3LEE heard on REF030-C via GB7ME-B".

The watch list is trigger-driven: `server.js` queries the `triggers` collection for every
distinct base REF callsign (no module letter) named in a `dvReflector` condition, unioned with
`config.dstar.reflectorLinks.alwaysWatch` (a fixed list, e.g. for local testing). Reflectors are
re-fetched every `refreshInterval` (default 2 minutes), with bounded concurrency
(`maxConcurrent`) and a per-reflector `timeout`.

A 2026 survey of the 57 REF reflectors that report to dstarusers.org found three dashboard
shapes: 50 serve a classic static HTML "Linked Gateways" table (`readers` type `html`, the
default - one, REF020, sits behind an HTML frameset, which is followed automatically as well as
via an explicit override), one (REF075) serves an equivalent JSON REST endpoint (`type: 'json'`,
`gateways: [{callsign, module}]`), and one (REF016) is WebSocket-push only with no HTTP fallback
at all and is marked `type: 'unsupported'` (watched but never fetched). Five reflectors were
unreachable on both HTTP and HTTPS at survey time and simply have no data to fetch; they need no
special configuration.

The directory never lets a broken watch-list query, a hung/unreachable dashboard, or a bad HTTP
status take down anything: a failing reflector keeps its previously-fetched table (backed off
for `failureBackoff` before being retried, logged once per failure episode) while every other
reflector refreshes normally, and `lookup()` itself is a pure, synchronous Map read that never
throws. Like `dstar_nodes.js`, the merged map is persisted to `dumpFile` so a restart has data
immediately.

Test it without a database: `node tools/dstarTest.js --links REF030,REF058` (live: builds the
directory for exactly those reflectors, waits for its first refresh, then runs the feeds as
usual) or `node tools/dstarTest.js --links-file <html|json> <path> <REF>` (offline: parses a
saved dashboard body, e.g. under `tools/fixtures/reflectors/`, and prints the resulting map;
combine with `--file`/`--dstarusers-file` to enrich that replay from the offline directory
instead).
