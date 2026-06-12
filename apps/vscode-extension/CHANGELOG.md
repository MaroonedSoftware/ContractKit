# @contractkit/vscode-extension

## 0.13.3

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0
    - @contractkit/prettier-plugin@0.12.0
    - @contractkit/explorer-ui@0.3.2

## 0.13.2

### Patch Changes

- df2bcff: VS Code extension: fix Explorer view and preview panels going stale on file changes. The LSP client now synchronizes `.ck` and `contractkit.config.json` file events to the server, so edits made outside the active editor (saves to closed files, git operations, external tools) are picked up. The **Refresh Explorer** command now forces a full server-side re-walk of every `.ck` file on disk, and the refresh title-bar button is also exposed on the preview/overview panels.

    Explorer UI: sort endpoints within each area on the Overview by route path then method, so the listing order is stable instead of reflecting parse order.

- Updated dependencies [df2bcff]
    - @contractkit/explorer-ui@0.3.1

## 0.13.1

### Patch Changes

- Updated dependencies [4c6bd6f]
    - @contractkit/explorer-ui@0.3.0

## 0.13.0

### Minor Changes

- 90f45ff: LSP cross-file diagnostics; CLI compiler-fingerprint helpers extracted
    - VS Code extension now surfaces cross-file diagnostics (unknown model refs, multi-base inheritance conflicts, operation-validation errors, options-block normalization warnings) directly in the editor. A new `ProjectValidator` debounces project-wide validation across all parsed `.ck` ASTs and merges its results with per-document parse diagnostics. Multi-config workspaces are supported via the existing `WorkspaceConfigCache`.
    - `@contractkit/core` `validateProject` accepts a new optional `getKeysForFile(filePath)` resolver so each file can use its own `contractkit.config.json` fallback keys. Falls through to the workspace-wide `fallbackKeys` when the resolver returns `undefined`. Strictly additive.
    - `@contractkit/cli` extracts the compiler-fingerprint helpers (`readNearestPackageVersion`, `computeCompilerFingerprint`) into a dedicated module with direct unit-test coverage. No behavior change.

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0
    - @contractkit/prettier-plugin@0.11.2
    - @contractkit/explorer-ui@0.2.1

## 0.12.0

### Minor Changes

- 0271384: Add a collapsible "Endpoints by area" list to the API Overview page. Each operation renders as a row with its method badge, route, and optional human-readable name; areas auto-expand when there are three or fewer. In the VS Code extension, clicking a row opens that operation in its own preview panel via a new `openOperation` webview message.

### Patch Changes

- Updated dependencies [0271384]
    - @contractkit/explorer-ui@0.2.0

## 0.11.0

### Minor Changes

- a049895: Add `resolveEffectiveFields` and `buildModelIndex` to `@contractkit/core` for flattening multi-base inheritance into a fully-resolved field list. The explorer UI gains `renderSchemaTree` and `renderCodeSamples` for structured request/response rendering with deterministic curl + JSON examples, a two-column operation layout with a right rail, faker-seeded Try-It pre-fill, and a file-level preview page. The VS Code extension follows the active `.ck` editor with a new live preview panel, gates its tree view on detected ContractKit projects, and supports multiple preview tabs for pinned items.

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0
    - @contractkit/explorer-ui@0.1.0
    - @contractkit/prettier-plugin@0.11.1

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

### Patch Changes

- Updated dependencies [af1a6c0]
    - @contractkit/explorer-ui@0.10.0

## 0.9.0

### Minor Changes

- dd8197b: **Breaking:** Replace the `requireMfa: boolean` field in `security: { ... }` blocks with `policy: <ident|none>`, and switch the generated Koa router middleware from `requireSecurity` to ServerKit's new `requirePolicy`.

    The `security` declaration on operations, routes, and the file-level `options { security: { ... } }` block no longer accepts a `requireMfa:` line. The new field is `policy:` and takes a bare identifier (the named policy) or the keyword `none` to explicitly bypass policy enforcement. Existing `.ck` files that use `requireMfa:` will fail to parse.

    ```ck
    # Before
    security: {
        requireMfa: true
    }

    # After
    security: {
        policy: paymentsWrite
    }

    # Explicit bypass
    security: {
        policy: none
    }
    ```

    **`@contractkit/core`** — `SecurityFields` interface drops `requireMfa` / `requireMfaDescription` and adds `policy?: string | false` / `policyDescription?: string`. The grammar's `SecurityRequireMfaLine` is replaced by `SecurityPolicyLine` (`policyKw ":" (noneKw | identifier)`). `security: none` (the route-level public sentinel) is unchanged.

    **`@contractkit/plugin-typescript`** — Generated Koa routers now import `requirePolicy` from `@maroonedsoftware/koa` (previously `requireSecurity`) and emit `requirePolicy({ policy: 'name' })`, `requirePolicy({ policy: false })`, or bare `requirePolicy()`. Consumers must upgrade ServerKit alongside.

    **`@contractkit/prettier-plugin`** — Formats `policy: <name>` and `policy: none` lines inside security blocks. Files containing `requireMfa:` will no longer round-trip and will surface as parse errors.

    **`@contractkit/plugin-markdown`** — The "Security: authenticated" admonition now shows `policy: <name|none>` instead of `requireMfa: <bool>`.

    **`@contractkit/openapi-to-ck`** — Non-empty OpenAPI `security` requirements continue to collapse to an empty `security: {}` (authenticated, default policy); the serializer now emits `policy:` lines when the field is set.

    **`contractkit-vscode-extension`** — TextMate grammar highlights `policy:` inside the security block; LSP completion offers `policy` instead of `requireMfa`. Re-run `pnpm run vscode:install` to pick up the change.

### Patch Changes

- Updated dependencies [dd8197b]
    - @contractkit/core@0.18.0
    - @contractkit/prettier-plugin@0.11.0

## 0.8.6

### Patch Changes

- Updated dependencies [79af33b]
    - @contractkit/core@0.17.0

## 0.8.5

### Patch Changes

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0

## 0.8.4

### Patch Changes

- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1

## 0.8.3

### Patch Changes

- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0

## 0.8.2

### Patch Changes

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0

## 0.8.1

### Patch Changes

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.8.0

### Minor Changes

- 876696f: Add a `plugins` block to operations for attaching external files to individual code-generators.

    ```
    post: {
        plugins: {
            bruno: "request-token.yml"
        }
    }
    ```

    Each entry maps a plugin name to a path relative to the contract's `.ck` file. The CLI resolves the path before plugins run and exposes the file content on the AST as `op.pluginFiles[name]`; missing files emit a warning. Plugins keyed by their own `name` can read their entry to override or augment generated output. The raw paths remain on `op.plugins` for round-trip use cases (the prettier plugin and VS Code syntax highlighting consume the raw form).

### Patch Changes

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.7.1

### Patch Changes

- 9269093: chore: update dependencies across multiple projects

    This commit updates various dependencies in the package.json files for several projects, including:
    - Upgraded `@changesets/cli`, `@types/node`, `@vitest/coverage-v8`, `eslint`, `prettier`, `turbo`, and `typescript` to their latest versions.
    - Updated `@types/vscode`, `@vscode/vsce`, and `esbuild` in the vscode extension.
    - Adjusted `@scalar/openapi-parser` and `yaml` in the openapi-to-ck package.
    - Enhanced ESLint and TypeScript configurations in the config-eslint package.

    These updates improve compatibility and maintainability across the codebase.

- Updated dependencies [c9f2166]
    - @contractkit/core@0.11.0

## 0.7.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.6.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0

## 0.5.0

### Minor Changes

- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0

## 0.4.3

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0

## 0.4.2

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0

## 0.4.1

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/contractkit@0.5.0

## 0.4.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/contractkit@0.4.0

## 0.3.0

### Minor Changes

- f396a68: Enhance scalar type support by adding 'interval' to the ContractKit

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
