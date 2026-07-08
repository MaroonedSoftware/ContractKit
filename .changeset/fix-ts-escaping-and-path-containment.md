---
'@contractkit/plugin-typescript': patch
---

Escape `.ck` descriptions, enum values, and signature strings when generating Zod schemas and TypeScript so `*/`, quotes, or newlines can no longer break or inject into generated output. Contain every generated-file path within the configured output directory, rejecting `options { keys }` values that would escape it. Throw on an unmapped scalar type instead of silently emitting `z.unknown()`/`unknown`.
