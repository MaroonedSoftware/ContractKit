# @contractkit/prettier-plugin-contractkit

## 0.9.2

### Patch Changes

- 1be6771: Fix prettier printer to re-quote enum values that contain spaces or other non-identifier characters, preventing round-trip parse failures for values like `"Sole Proprietorship"`.

## 0.9.1

### Patch Changes

- 7555412: Round-trip path-like values in `options.keys` and `options.services` correctly.

    Values that aren't plain identifiers (paths with slashes, values starting with `.` or `#`, values containing spaces, etc.) are now consistently double-quoted on output. Previously only values starting with `#` or containing spaces were quoted, so a value like `"../../bruno"` lost its quotes on round-trip and re-parsed as a different shape.

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.9.0

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

## 0.8.1

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

## 0.8.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.7.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0

## 0.6.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0

## 0.5.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0

## 0.4.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/contractkit@0.5.0

## 0.3.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/contractkit@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
