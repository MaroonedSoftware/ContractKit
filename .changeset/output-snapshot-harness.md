---
---

Add `packages/output-tests`, a private workspace package that runs all five codegen plugins over a pair of `.ck` fixtures and snapshots every emitted file.

The existing plugin suites assert with `expect(output).toContain(…)`, which can only observe what a generator *does* emit. Nothing checked what a file no longer contains, and nothing looked at a generated file as a whole, so a defect that leaves the output syntactically valid but semantically wrong stayed invisible. This package closes that gap: each emitted file gets a `toMatchFileSnapshot` baseline, and a per-plugin `_files.txt` listing records the emitted path set so a file being lost or added shows up as a diff rather than as an assertion that quietly stops running.

The fixtures are chosen to cover the constructs the generators disagree on today: path params declared as a model ref, response headers typed `string`/`int`/optional `boolean`, an operation declaring only a documented `400`, inline `query` and `headers` blocks mixing required and optional fields, writeonly models with and without a writeonly child, multipart and urlencoded request bodies, a deprecated operation that also carries a description, and `decimal`/`datetime`/`duration`/`bigint` fields alongside a second fixture using none of them.

A hyphenated path param gets a fixture of its own. It is the case the Python generator must snake_case, and it is separately the case every TypeScript generator turns into an invalid identifier (`async getInvoice(invoice-id: string)`); isolating it confines that parse failure to one emitted file per generator so the other fixtures' output stays readable. The same applies to `.ck` filenames: a hyphen there produces `export const Kitchen-sinkRouter`, so the fixtures avoid one.

No published package changes; this is test infrastructure only.
