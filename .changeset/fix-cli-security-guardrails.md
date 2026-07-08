---
'@contractkit/cli': patch
---

Contain per-operation plugin `file://` reads and all generated-file writes/deletes within the project root, so a crafted `.ck` file can't read or overwrite files outside the repo. Add SSRF guardrails to `http(s)://` plugin-extension fetches (block private/loopback/link-local/metadata targets with DNS-rebinding protection, refuse redirects, and enforce a request timeout and response-size cap). Validate the HTTP response cache with a stored content hash and TTL, treating tampered, mismatched, or stale entries as misses.
