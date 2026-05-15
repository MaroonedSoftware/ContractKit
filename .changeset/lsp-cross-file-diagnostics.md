---
'contractkit-vscode-extension': minor
'@contractkit/core': minor
'@contractkit/cli': minor
---

LSP cross-file diagnostics; CLI compiler-fingerprint helpers extracted

- VS Code extension now surfaces cross-file diagnostics (unknown model refs, multi-base inheritance conflicts, operation-validation errors, options-block normalization warnings) directly in the editor. A new `ProjectValidator` debounces project-wide validation across all parsed `.ck` ASTs and merges its results with per-document parse diagnostics. Multi-config workspaces are supported via the existing `WorkspaceConfigCache`.
- `@contractkit/core` `validateProject` accepts a new optional `getKeysForFile(filePath)` resolver so each file can use its own `contractkit.config.json` fallback keys. Falls through to the workspace-wide `fallbackKeys` when the resolver returns `undefined`. Strictly additive.
- `@contractkit/cli` extracts the compiler-fingerprint helpers (`readNearestPackageVersion`, `computeCompilerFingerprint`) into a dedicated module with direct unit-test coverage. No behavior change.
