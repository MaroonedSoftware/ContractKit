# @contractkit/core

## 0.14.0

### Minor Changes

- a9e9ec0: Replace per-operation `pluginFiles` with structured `pluginExtensions`. The `plugins:` block on an operation now accepts JSON-like values (string, number, boolean, null, object, array) so each plugin owns its own schema for its entry. `file://` URLs in any string position are resolved relative to the `.ck` source file before plugins run, and `http://` / `https://` URLs are fetched via GET. `op.pluginExtensions` carries the resolved tree; the raw form lives at `op.plugins`. The Bruno plugin now expects `{ template: "file://..." }` (was a bare path string) and ships a `validateBrunoExtension` hook that fails compilation on unknown fields or non-string `template`.

    Plugins can now implement `validateExtension(value)` on the `ContractKitPlugin` interface to surface compilation-time errors/warnings on their entry.

    All CLI caching is unified under `<rootDir>/.contractkit/cache/` via a new `CacheService` class: `build.json` for file/plugin hashes and `http/<sha256(url)>` for fetched HTTP response bodies. The `cache: string` config field is reinterpreted as a custom cache **directory** (was a custom build-cache filename); previous file paths under `.contractkit-cache` and `.contractkit-http-cache/` are abandoned. Add `.contractkit/` to `.gitignore`.

## 0.13.0

### Minor Changes

- 7555412: Add `{{var}}` variable substitution in `.ck` files.

    Variables declared in a file's `options { keys: { ... } }` block can now be referenced from any string in the file as `{{name}}`. The CLI also collects a workspace-wide fallback map from each plugin entry's `options.keys` in `contractkit.config.json`, so an author can define a key once and use it across every `.ck` file.
    - `{{name}}` → resolved from `options.keys` first, then the plugin-config fallback. Unknown variables emit the literal string `undefined` and a warning (`Unknown variable '{{name}}'`).
    - `\{{name}}` → escapes the substitution; the literal characters `{{name}}` are emitted with no warning.

    Substitution runs as a post-parse normalization pass (after `applyOptionsDefaults`), so the prettier plugin still round-trips the source form.

    Example:

    ```
    options {
        keys: { bruno: "../../bruno" }
    }

    operation /auth/token: {
        post: {
            plugins: { bruno: "{{bruno}}/authentication/request.token.yml" }
            response: { 201: { application/json: AuthenticationToken } }
        }
    }
    ```

## 0.12.0

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

## 0.11.0

### Minor Changes

- c9f2166: Path parameters now accept the full type-expression syntax — including constraint args (`int(min=1, max=5)`), enums (`enum(available, pending, sold)`), regex strings, and unions — instead of only a bare type identifier.

## 0.10.0

### Minor Changes

- bbee232: prep for public release

## 0.9.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

## 0.8.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

## 0.7.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

## 0.6.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

## 0.5.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

## 0.4.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

## 0.3.0

### Minor Changes

- f396a68: Enhance scalar type support by adding 'interval' to the ContractKit

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org
