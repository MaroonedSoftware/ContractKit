---
'@repo/config-eslint': patch
'@contractkit/openapi-to-ck': patch
'@contractkit/plugin-python': patch
'@contractkit/vscode-extension': patch
'@contractkit/prettier-plugin': patch
---

chore: update dependencies across multiple projects

This commit updates various dependencies in the package.json files for several projects, including:

- Upgraded `@changesets/cli`, `@types/node`, `@vitest/coverage-v8`, `eslint`, `prettier`, `turbo`, and `typescript` to their latest versions.
- Updated `@types/vscode`, `@vscode/vsce`, and `esbuild` in the vscode extension.
- Adjusted `@scalar/openapi-parser` and `yaml` in the openapi-to-ck package.
- Enhanced ESLint and TypeScript configurations in the config-eslint package.

These updates improve compatibility and maintainability across the codebase.
