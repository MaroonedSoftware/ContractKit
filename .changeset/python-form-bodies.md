---
'@contractkit/plugin-python': minor
---

Send multipart and urlencoded request bodies as forms.

`body_kind` was emitted only for `text` and `binary`, so `application/x-www-form-urlencoded` and `multipart/form-data` fell through to the `"json"` default and the base client sent them via httpx's `json=`. A urlencoded body went out as a JSON document under a form `Content-Type`, which no server parses; a multipart body raised a `TypeError` before it left the process.

The generated call now passes `body_kind="form"` or `body_kind="multipart"`, and `_request` routes them to httpx's `data=` and `files=` respectively.

The `Content-Type` header is no longer set for multipart. httpx has to generate the boundary itself, and it can only do that if it owns the header; setting it here produced a multipart content type with no boundary parameter. This mirrors why the TypeScript SDK omits the header for `FormData` bodies.

**Minor rather than patch, because a multipart body's parameter type changes** from `bytes` to `dict`. httpx's `files=` takes a mapping of part name to content and derives the boundary from it, so `bytes` could never have worked: it is the whole payload with no boundary, and a caller had no way to supply one. Anyone with a multipart operation has code that raises today, so the signature change cannot break a working call site.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.
