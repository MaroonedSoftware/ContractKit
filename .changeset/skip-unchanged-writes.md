---
'@contractkit/cli': patch
---

Skip writing generated files when the on-disk content already matches. Avoids spurious mtime bumps that triggered downstream rebuild cascades (tsc watch, vite, etc.) for plugins that emit unconditional global files (TS SDK barrels, aggregator, Bruno collections). The compile summary now reports written vs. unchanged counts.
