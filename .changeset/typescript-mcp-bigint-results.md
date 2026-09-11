---
'@contractkit/plugin-typescript': patch
---

An MCP tool whose operation returns a `bigint` no longer fails. The generated `handle` called a bare `JSON.stringify(result)` for its text content, which throws on a `bigint`, and passed the raw result as `structuredContent`, which the dispatcher serializes again and would throw on too. A tool whose result can reach a `bigint`, through any emitted body or response header, now stringifies it once with `bigIntReplacer` and hands `structuredContent` the parsed-back JSON, so both carry `"123n"`, the same form the HTTP route sends. Tools with no `bigint` in their result are unchanged.
