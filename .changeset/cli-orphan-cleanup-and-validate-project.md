---
'@contractkit/core': minor
'@contractkit/cli': minor
---

cli: orphan cleanup + compiler-version cache invalidation; core: shared validateProject

- The CLI now deletes generated files whose owning plugin no longer claims them (plugin removed from config, renamed, or output set shrank). Cleanup is best-effort and never deletes a file emitted under another plugin in the same run.
- Build cache is now stamped with a fingerprint of `@contractkit/cli`, `@contractkit/core`, and every loaded plugin's package version. A mismatch on load drops the cache, so a `pnpm update` of any codegen-affecting package forces a full rebuild instead of silently serving stale `.ts`.
- `computePluginFingerprint` accepts an optional plugin version so a single plugin upgrade invalidates only its slice when the top-level fingerprint changes are noisy.
- New `validateProject` helper in `@contractkit/core` runs parse + options-defaults + variable-substitution + decompose + cross-file `validateRefs`/`validateInheritance`/`validateOp` in one call. Designed to be the single source of truth for CLI and LSP semantics. The LSP can adopt it incrementally to surface cross-file diagnostics in the editor; the CLI keeps its inline pipeline for now so plugin `validate`/`transform` hooks continue to run between normalization and validation.
