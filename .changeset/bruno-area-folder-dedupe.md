---
'@contractkit/plugin-bruno': patch
---

Emit each area-level `folder.yml` exactly once instead of once per root sharing the area. Previously, an area with N op-roots (e.g. one top-level plus several subareas) wrote the same `<area>/folder.yml` N times in a single run, each with a different `seq` derived from the root index. The seq is now an area-position counter, so the file is stable across runs.
