# HamAlert server

This is the source code for the HamAlert server, the backend that processes spots from various sources, matches them against the triggers that the users have defined, and sends out notifications through various channels.

It is a Node.js application which spawns separate matcher processes (via IPC) to spread out the matching workload across multiple cores. Currently it is designed to run on a single server only as that is more than sufficient to handle the workload and foreseeable user growth.

## D-STAR presence source

`dstar.js` is a presence source rather than a spot source: it reports when a callsign becomes
active on, or links to, a D-STAR repeater module or reflector module. It tails the public
"last heard" logs of QuadNet (`openquad.net`) and ircDDB (`live.ircddb.net`), classifies each
transmission (voice vs. link command; info/echo/unlink commands are ignored) and emits one
spot per callsign, node, reflector and event type per `config.dstar.dedupeInterval`.

Spots have `source: 'dstar'`, `mode: 'dstar'`, no frequency, and the fields `dvEvent`
(`active` or `linked`), `dvNode` (e.g. `W4HFH C`) and `dvReflector` (e.g. `REF030 C`). The
matcher accepts `dvNode`/`dvReflector` conditions with or without the module letter.

Test without a database: `node tools/dstarTest.js` (live feeds) or
`node tools/dstarTest.js --file <saved log>`.
