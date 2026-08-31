# @contractkit/explorer-ui

## 0.5.1

### Patch Changes

- ffb2ec6: Ship an `llms.txt` in every package, so an AI assistant reading the package out of `node_modules` gets its exact name, a config block with real key names, the full option table, the programmatic API, and the mistakes specific to it — without needing the repo checked out.

    Correct several documented snippets that could not work as written. The five plugin READMEs named packages that do not exist (`@contractkit/contractkit-plugin-*`, and `-python-sdk` for the Python plugin) in both their install commands and their `contractkit.config.json` keys. `@contractkit/core`'s README exported `Diagnostics` and `validateOperation`, which are really `DiagnosticCollector` and `validateOp`, and gave the wrong signatures for three validation passes. `@contractkit/cli`'s README documented the OpenAPI importer as `contractkit openapi-to-ck --input <spec>`; it is `contractkit import-openapi <spec>`, with the path positional. `@contractkit/plugin-openapi` described its output as OpenAPI 3.0, but it emits 3.1.

- Updated dependencies [ffb2ec6]
    - @contractkit/core@0.28.1

## 0.5.0

### Minor Changes

- e102a2c: Add a `decimal` scalar, for money and anything else that has to be exact

    `number` compiles to `z.coerce.number()` — an IEEE-754 double. Anything monetary has to be exact,
    so contracts either lied about their types or routed the value through `string` by hand. `decimal`
    gives the language a type for it:

    ```
    contract Payslip: {
        gross: decimal(min=0, scale=2)
        rate: decimal
    }
    ```

    A decimal travels as a **quoted JSON string** (`{"gross": "1250.00"}`) and becomes a decimal.js
    `Decimal` — the same class Prisma hands you for a `Decimal` column, so a value moves between the
    two with no conversion. Python gets `decimal.Decimal`; OpenAPI gets `type: string, format: decimal`.

    A raw JSON number is **rejected**, not coerced. By the time one reaches the schema it has already
    been through a double, which is precisely the loss the scalar exists to prevent, so accepting it
    would defeat the point silently.

    **`scale=` is a validation constraint — at most N decimal places — not a formatting directive.**
    It cannot be one: the router assigns `ctx.body` and Koa serializes it with a `JSON.stringify` we
    have no replacer for, so the wire form is whatever decimal.js normalizes to and `"1250.00"` reads
    back as `"1250"`. The two are the same number; format at the display edge if you need the trailing
    zeros. This is also what `scale` means in OpenAPI `pattern`, pydantic `condecimal(decimal_places=)`
    and Prisma `@db.Decimal(_, n)`, so every downstream mapping stays honest.

    Generated code sets `Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 })` so values never serialize in
    exponential notation — without it `0.00000001` ships as `"1e-8"` and any peer validating
    `^-?\d+(\.\d+)?$` rejects it. Note this is global decimal.js configuration and affects every
    `Decimal` in the consuming process.

    SDK clients rehydrate decimals through generated `reviveX` functions. The `bigint` approach does
    not transfer — it works only because bigint invented a tagged `"123n"` wire encoding, and tagging a
    decimal would corrupt the format for every non-ContractKit consumer. Re-parsing responses through
    the Zod schema is not available either: `XOutput` is a type alias with no runtime value, and models
    default to `z.strictObject`, so any field the server added would throw in every deployed client.
    The revivers mutate in place, which preserves unknown server-added keys.

    Two placements are rejected at parse time, both errors rather than warnings since no existing
    contract can be relying on them. A decimal inside an **undiscriminated union** cannot be rehydrated
    — the SDK has no way to tell which arm arrived, and a convert-if-string fallback would silently
    rewrite a genuine `string` field in a sibling arm. A decimal in a **response header** has no
    parsing step at all, so the annotation would simply be false at runtime.

    `min`/`max` are kept as exact decimal strings rather than coerced through `Number()`, and OpenAPI
    carries them in `x-contractkit-min`/`-max` extensions, since JSON Schema's numeric `minimum` and
    `maximum` are ignored on a string type. A contract round-trips through OpenAPI and back with its
    bounds intact.

    SDKs that scaffold a `package.json` gain `decimal.js` as a dependency when a covered model uses the
    scalar. Existing scaffolds are write-once and are not updated, so add it by hand there.

### Patch Changes

- Updated dependencies [e102a2c]
    - @contractkit/core@0.28.0

## 0.4.3

### Patch Changes

- Updated dependencies [aea5e21]
- Updated dependencies [5dc2693]
    - @contractkit/core@0.27.0

## 0.4.2

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.
- Updated dependencies [ca1c139]
    - @contractkit/core@0.26.1

## 0.4.1

### Patch Changes

- Updated dependencies [ab69718]
    - @contractkit/core@0.26.0

## 0.4.0

### Minor Changes

- 85d7566: Let an operation emit more than one status, and a status serve more than one content type.

    A status code could previously declare only one mime — the parser warned `Duplicate response body` and dropped the rest — and the generated router pinned both `ctx.status` and `ctx.type` to whichever response happened to be listed first with a body. An endpoint serving several formats had to declare one lying mime and let browsers sniff, and a service had no way to say which status it produced.

    A status now holds every declared `mime: Type` line (`OpResponseNode.bodies`). When there is more than one, the service picks at runtime and the router sets `ctx.type` from the returned `contentType`. When an operation produces more than one status, the service returns a union discriminated on `status` and the handler switches on it, so each status writes only its own headers, mime and body. Both SDKs mirror the router: the TypeScript and Python clients return a matching union, report which mime came back, and pass the non-2xx statuses they expect to the shared fetch so a declared `304` no longer surfaces as an error. `SdkError` now takes a body type parameter, and each operation exports a `…ErrorBody` alias for the statuses that stay on the throw path.

    Which statuses the service produces is derived from the declaration: **a status is emitted if it has a block, or is 2xx.** An empty block (`304: {}`) says the service returns that status carrying nothing; a bare `304:` says it is documented and something else produces it. `404(documented): { … }` is the one modifier, forcing a block-carrying status back out.

    Two long-standing bugs in the same area go with it. The formatter deleted any comment written inside a `response` block — above a status code, above a mime line, above a `headers:` block, or before a closing brace — so `pnpm format` silently threw away the notes explaining why a contract looks the way it does; all four positions now round-trip. And the generated router declared a `_ZodBinary` helper for a binary _response_ body, which is a plain `Buffer` annotation with no schema behind it, leaving an unused const that tripped `noUnusedLocals` downstream; helpers are now chosen from the code that was actually generated, the same way imports already were.

    **If you are already on a pre-release version, two things change under you.** A contract that declares a body on an error status — `404: { application/json: Problem }` alongside a `200` — now returns it from the service instead of throwing, and the SDK return type becomes a union; add `(documented)` to that status to keep the previous behaviour. Contracts whose error statuses are bodyless (`400:`, `404:`) are unaffected. Anything reading the AST directly should move from `OpResponseNode.contentType`/`bodyType` to `bodies`, which replaces them.

### Patch Changes

- Updated dependencies [85d7566]
- Updated dependencies [90d19ee]
    - @contractkit/core@0.25.0

## 0.3.5

### Patch Changes

- Updated dependencies [23e4beb]
    - @contractkit/core@0.24.0

## 0.3.4

### Patch Changes

- Updated dependencies [2bf01f1]
    - @contractkit/core@0.23.0

## 0.3.3

### Patch Changes

- Updated dependencies [0d3b8e2]
    - @contractkit/core@0.22.0

## 0.3.2

### Patch Changes

- fff30df: Add a block form to the operation `signature:` key. Alongside the existing bare form (`signature: KEY`), you can now write `signature: { options: KEY, policy: name }` to attach a signature-scoped policy. The policy is passed through to the generated `requireSignature(KEY, { policy: name })` middleware and surfaces in OpenAPI-to-`.ck` output, Markdown docs, and the explorer UI. The bare form is unchanged and remains shorthand for a block with only `options:`.
- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0

## 0.3.1

### Patch Changes

- df2bcff: VS Code extension: fix Explorer view and preview panels going stale on file changes. The LSP client now synchronizes `.ck` and `contractkit.config.json` file events to the server, so edits made outside the active editor (saves to closed files, git operations, external tools) are picked up. The **Refresh Explorer** command now forces a full server-side re-walk of every `.ck` file on disk, and the refresh title-bar button is also exposed on the preview/overview panels.

    Explorer UI: sort endpoints within each area on the Overview by route path then method, so the listing order is stable instead of reflecting parse order.

## 0.3.0

### Minor Changes

- 4c6bd6f: `renderOperation` accepts a new `collapsible` option that emits the card as an open `<details>` with the header row as its `<summary>`. The single-file detail page now uses this when a file declares more than one operation, so each route can be folded individually.

## 0.2.1

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0

## 0.2.0

### Minor Changes

- 0271384: Add a collapsible "Endpoints by area" list to the API Overview page. Each operation renders as a row with its method badge, route, and optional human-readable name; areas auto-expand when there are three or fewer. In the VS Code extension, clicking a row opens that operation in its own preview panel via a new `openOperation` webview message.

## 0.1.0

### Minor Changes

- a049895: Add `resolveEffectiveFields` and `buildModelIndex` to `@contractkit/core` for flattening multi-base inheritance into a fully-resolved field list. The explorer UI gains `renderSchemaTree` and `renderCodeSamples` for structured request/response rendering with deterministic curl + JSON examples, a two-column operation layout with a right rail, faker-seeded Try-It pre-fill, and a file-level preview page. The VS Code extension follows the active `.ck` editor with a new live preview panel, gates its tree view on detected ContractKit projects, and supports multiple preview tabs for pinned items.

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0

## 0.10.0

### Minor Changes

- af1a6c0: Add an API Explorer to the VS Code extension and a new shared rendering package.

    The extension now contributes an **API Explorer** tree view to the Explorer view container, listing every endpoint and model across the workspace's `.ck` files. Clicking a node opens a Stoplight-style detail panel beside the editor with description, parameters, request and response schemas, security badges, and plugin extensions. Model refs inside operations expand inline as collapsible blocks with cycle detection. Every section has a jump-to-source button.

    Adjacent capabilities:
    - **Filter & grouping** — title-bar buttons for case-insensitive filtering and switching between `file` / `area` / `method` / `flat` grouping (persisted per workspace).
    - **Right-click actions** on tree nodes — Reveal in Editor, Copy Path, Copy as cURL.
    - **Markdown rendering** in operation/model/field descriptions and in tree tooltips.
    - **Try-it** — every operation card gets a collapsible form prefilled with schema params; the Send button runs the request from the extension host (Node `fetch`) and shows status / headers / body in-place. Configure the default base URL via the new `contractkit.tryItOut.baseUrl` setting.
    - **Status bar** entry showing API title and counts, with a warning badge when the builder collects diagnostics.

    The rendering layer ships as a new `@contractkit/explorer-ui` package — pure HTML strings, themable via `--ce-*` CSS custom properties, no runtime dependency on `@contractkit/core` (types only). The package is consumed by the VS Code extension today and is structured for a future `@contractkit/plugin-explorer` static-site generator.
