# @contractkit/cli

## 0.6.0

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

- 876696f: Print all warnings and errors once at the end of the run, after file writes, instead of interleaving them with intermediate compilation phases. Errors that previously appeared twice (once at parse-time, once at the end) now appear only at the bottom of the output where they're easier to spot.
- Updated dependencies [876696f]
    - @contractkit/core@0.12.0
    - @contractkit/openapi-to-ck@0.7.2

## 0.5.1

### Patch Changes

- Updated dependencies [c9f2166]
- Updated dependencies [9269093]
    - @contractkit/core@0.11.0
    - @contractkit/openapi-to-ck@0.7.1

## 0.5.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0
    - @contractkit/openapi-to-ck@0.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0
    - @maroonedsoftware/openapi-to-ck@0.6.1

## 0.4.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0
    - @maroonedsoftware/openapi-to-ck@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [9b13e28]
    - @maroonedsoftware/openapi-to-ck@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0
    - @maroonedsoftware/openapi-to-ck@0.4.2

## 0.3.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0
    - @maroonedsoftware/openapi-to-ck@0.4.1

## 0.2.3

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/openapi-to-ck@0.4.0
    - @maroonedsoftware/contractkit@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/openapi-to-ck@0.3.0
    - @maroonedsoftware/contractkit@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0
    - @maroonedsoftware/openapi-to-ck@0.2.1

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
- Updated dependencies [6aa2aa0]
    - @contractkit/core@0.2.0
    - @contractkit/openapi-to-ck@0.2.0
