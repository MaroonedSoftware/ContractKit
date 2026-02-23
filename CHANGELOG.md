# Changelog

## [0.2.0]

### Fixed

- **Regex escaping in generated code** -- Forward slashes in regex constraints are now properly escaped in Zod output, preventing invalid regex literals.
- **String literal escaping** -- Quotes, backslashes, and newlines in default values, descriptions, and literal types are now escaped in generated code.
- **Missing path param type warning** -- The compiler now warns when a `params` block field has no explicit type instead of silently defaulting to `string`.

### Added

- **Configuration file support** -- The compiler reads `contract-dsl.config.json` from the project directory (or any parent), supporting `outDir`, `patterns`, `servicePathTemplate`, and `typeImportPathTemplate`. CLI flags override config values.
- **Configurable service module paths** -- Service import paths and type import paths in generated `.op` code can be customized via templates with `{name}`, `{kebab}`, and `{module}` placeholders.
- **Comment descriptions for `.op` files** -- `#` comments before routes and operations are parsed as descriptions and emitted as JSDoc comments in generated router code.
- **Source line comments in generated code** -- Generated `.dto.ts` and `.router.ts` files include comments indicating the source file and line number (e.g., `// from User (user.dto:1)`).
- **Incremental compilation** -- When using `--out-dir`, the compiler caches SHA-256 hashes of source files and skips unchanged files on subsequent runs. Use `--force` to bypass.
- **Cross-file type reference validation** -- The compiler validates that model references in `.dto` fields, inheritance bases, and `.op` request/response types exist across all parsed files. Undefined references emit warnings.
- **VS Code extension test suite** -- Added 17 tests covering the workspace index, completion provider, and hover provider.
- **Snapshot tests** -- Added snapshot tests for generated output of real contract files (ledger accounts, pagination, ledger operations, transfers operations).
- **README documentation** -- Added comprehensive project documentation with DSL language reference, CLI usage, configuration, and project structure.

### Changed

- **Two-pass compilation** -- The CLI now parses all files before generating code, enabling cross-file validation. Previously, files were compiled independently.
- **CLI flags** -- Added `--service-path <template>` and `--force` flags.

## [0.1.0]

Initial release with `.dto` and `.op` compilation, Zod schema generation, Koa router generation, and VS Code extension with syntax highlighting and language server.
