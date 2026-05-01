---
'@contractkit/prettier-plugin': patch
---

Round-trip path-like values in `options.keys` and `options.services` correctly.

Values that aren't plain identifiers (paths with slashes, values starting with `.` or `#`, values containing spaces, etc.) are now consistently double-quoted on output. Previously only values starting with `#` or containing spaces were quoted, so a value like `"../../bruno"` lost its quotes on round-trip and re-parsed as a different shape.
