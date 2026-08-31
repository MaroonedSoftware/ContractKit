---
'@contractkit/core': patch
---

Ship the `.ck` language reference inside the package (`dist/language.md`, linked from `llms.txt` alongside the already-local `dist/contractkit.ohm` grammar) and publish from a `files` allowlist, so the tarball no longer carries `src/`, `tests/`, and build logs.
