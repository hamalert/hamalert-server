# HamAlert server

This is the source code for the HamAlert server, the backend that processes spots from various sources, matches them against the triggers that the users have defined, and sends out notifications through various channels.

It is a Node.js application which spawns separate matcher processes (via IPC) to spread out the matching workload across multiple cores. Currently it is designed to run on a single server only as that is more than sufficient to handle the workload and foreseeable user growth.
