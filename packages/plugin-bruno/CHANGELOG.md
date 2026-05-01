# @contractkit/contractkit-plugin-bruno

## 0.10.0

### Minor Changes

- 876696f: Omit optional fields from generated request body skeletons instead of emitting them as `null`.

    Previously, an optional field with no default produced `"nickname": null` in the example JSON body. The field is now absent so the example body sends only what the contract actually requires, matching how most APIs treat "omit" vs. "explicit null".

- f2d6a74: Add YAML override support to the Bruno plugin via per-operation plugin files and a new `overrideDir` config option.

    Per-operation overrides: declare `plugins: { bruno: "override.yml" }` on an operation in a `.ck` file and the file's YAML content is deep-merged into the generated request file at codegen time. Objects recurse; arrays replace entirely.

    Directory overrides: set `overrideDir` in the plugin config to a directory that mirrors the generated output structure. Any file found there is deep-merged into the matching generated file, enabling overrides for collection-level files (`opencollection.yml`, `environments/local.yml`) as well as individual request files.

    The `mergePluginFile` function is now exported from `@contractkit/plugin-bruno` for use in custom tooling.

### Patch Changes

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.9.1

### Patch Changes

- Updated dependencies [c9f2166]
    - @contractkit/core@0.11.0

## 0.9.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.8.0

### Minor Changes

- e27b771: Add an `includeInternal: boolean` config option to every plugin so consumers can override whether `internal` operations are emitted. Defaults preserve today's behavior: server router and Bruno default to `true` (include); TS SDK, Python SDK, OpenAPI, and Markdown default to `false` (exclude).

## 0.7.1

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0

## 0.7.0

### Minor Changes

- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0

## 0.6.0

### Minor Changes

- 5d42e39: Enhance Python and TypeScript SDKs to support typed response headers. Updated the Python client to generate `TypedDict` for response headers and modified return types accordingly. The TypeScript SDK now includes runtime assertions for required headers and documents them in the generated markdown. Tests were added to verify the correct handling of response headers in both SDKs.

## 0.5.1

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0

## 0.5.0

### Minor Changes

- 5ccdeea: Enhance contractkit-plugin-bruno by adding support for random example generation in request files. Introduced a manifest file to track generated files, enabling cleanup of stale outputs while preserving user-added files. Updated README and tests to reflect these changes.

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
