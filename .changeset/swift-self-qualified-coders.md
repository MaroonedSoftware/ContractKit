---
'@contractkit/plugin-swift': patch
---

A model with a field named `container`, `encoder` or `decoder` now compiles. The generated
`encode(to:)` and `init(from:)` read each stored property bare, beside a local `container` and the
`encoder` or `decoder` parameter, so a field with one of those names resolved to the local instead:
`try container.encode(container, forKey: .container)` failed to compile, and a literal field's
guard in `init(from:)` compared the wrong value. Every property read in a coder is now written
`self.<name>`. Found by building the SDK for a real service whose status model has a `container`
field; `stress.ck` now holds a contract with all three names, and the probe decodes, encodes and
rejects through it.
