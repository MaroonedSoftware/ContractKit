---
'@contractkit/plugin-openapi': patch
---

Quote numeric YAML keys, so response status codes are strings as OpenAPI requires.

`yamlKey` left any key matching `/^[\w-]+$/` bare, which includes `200`. A YAML 1.2 parser reads a bare `200:` as the integer `200`, while OpenAPI 3.x specifies the keys of a `responses` object as strings — so a strict validator rejected the emitted document, and any consumer indexing the map by `"200"` missed it.

The guard now excludes a leading digit, mirroring the one `yamlString` has carried all along. `\w` also matches `_`, so a key like `_3DModel` correctly stays bare.

This was invisible to the existing tests because they assert on the emitted *text*, and the defect is in how a conforming parser interprets those bytes. A new test parses the output with `yaml`'s document API, which preserves each key's actual scalar type, and asserts every response key came back as a string.

The reverse direction is unaffected: `openapi-to-ck` reads responses through `Object.entries`, which hands back string keys either way.

Visible in diffs but not breaking: `200:` becomes `'200':`.
