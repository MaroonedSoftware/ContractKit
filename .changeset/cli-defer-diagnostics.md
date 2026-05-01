---
'@contractkit/cli': patch
---

Print all warnings and errors once at the end of the run, after file writes, instead of interleaving them with intermediate compilation phases. Errors that previously appeared twice (once at parse-time, once at the end) now appear only at the bottom of the output where they're easier to spot.
