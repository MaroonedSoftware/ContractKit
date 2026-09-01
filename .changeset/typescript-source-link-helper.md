---
'@contractkit/plugin-typescript': patch
---

Fix the source links in generated TypeScript, which were malformed and did not resolve.

Every generated schema, router, SDK client and MCP tool carries a markdown link back to the `.ck` declaration it came from. Those links were written as `[User](file://./../contracts/user.ck#L5)`. The `file://` prefix opens a URL authority component, so the `.` that follows parses as the *host* rather than as a path segment, and the link resolves to nothing in an editor or a rendered doc. The correct form for a path relative to the emitted file is simply `[User](../contracts/user.ck#L5)`, which is what is now emitted.

The seven sites that built this link each recomputed `relative(dirname(outPath), sourceFile)` by hand and concatenated the pieces inline. They now share one `sourceLink(label, outPath, sourceFile, line?)` helper in `ts-render.ts`, alongside `quoteKey`, `escapeJsDocLines` and `headerNameToProperty`. The helper returns just the link, since some callers wrap it in a JSDoc block and one emits it in a `//` comment. A path that does not already begin with `.` gains a `./` prefix so it reads unambiguously as relative.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `2`. `runIncrementalCodegen` honours a cached manifest whenever its recorded `codegenVersion` matches, so without the bump anyone with a warm `.contractkit/cache` would keep the old files after upgrading.

Visible in diffs but not breaking: the doc links change form. Nothing imports or depends on their text.
