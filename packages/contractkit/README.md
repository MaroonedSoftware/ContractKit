# @contractkit/core

The core compiler library for ContractKit — a domain-specific language for defining HTTP API contracts in `.ck` files. This package provides the parser, AST, validation passes, and plugin interface; it does not generate code on its own. Code generation is handled by separate plugin packages (TypeScript, Python, OpenAPI, Markdown, Bruno) consumed via the [@contractkit/cli](../../apps/cli) binary.

## Installation

```bash
pnpm add @contractkit/core
```

You typically don't depend on `@contractkit/core` directly — it's a transitive dependency of the CLI and plugins. Depend on it explicitly only when **writing your own plugin**.

## What's exported

```typescript
import {
    parseCk,
    Diagnostics,
    applyOptionsDefaults,
    validateRefs,
    validateInheritance,
    validateOperation,
    type ContractKitPlugin,
    type PluginContext,
    type CkRootNode,
    type ContractTypeNode,
    type FieldNode,
    type ModelNode,
    type OpRouteNode,
    type OpOperationNode,
    type OpParamNode,
} from '@contractkit/core';
```

| Export | Purpose |
| --- | --- |
| `parseCk(source, file, diag)` | Parse a `.ck` source string into a typed AST. Errors and warnings are collected on the supplied `Diagnostics` instance. |
| `Diagnostics` | Mutable error/warning collector passed through every parsing and validation pass. |
| `applyOptionsDefaults(root)` | Normalization pass that merges file-level `options { request/response: { headers } }` into each operation. Run after `parseCk`, before downstream consumers. |
| `applyVariableSubstitution(root, diag, fallbackKeys?)` | Normalization pass that expands `{{name}}` references in every string field of the AST using `root.meta` first, then the optional `fallbackKeys` map. Run after `applyOptionsDefaults`. |
| `validateRefs(roots)` | Cross-file type-reference validation. Warns when a model is referenced but not declared anywhere. |
| `validateInheritance(roots)` | Multi-base inheritance validation — cross-base conflicts, `override` requirement, cycle detection. |
| `validateOperation(route, root)` | Validates an operation against config constraints (path-param coverage, service references, signature schemes). |
| `ContractKitPlugin` / `PluginContext` | Interfaces a plugin author implements/consumes. See **Plugin API**. |
| AST node types | `CkRootNode`, `ContractTypeNode`, `FieldNode`, `ModelNode`, `OpRouteNode`, `OpOperationNode`, `OpParamNode`, etc. |

## The `.ck` language

See the [root README](../../README.md#dsl-language-reference) for the full language reference. A short example:

```
options {
    keys: { area: payments }
    services: { PaymentsService: "#src/services/payments.service.js" }
}

contract Payment: {
    id: readonly uuid
    amount: number(min=0)
    currency: string(len=3)
    status: enum(pending, completed, failed) = pending
}

operation /payments/{id}: {
    params: { id: uuid }
    get: {
        sdk: getPayment
        service: PaymentsService.getById
        response: { 200: { application/json: Payment } }
    }
}
```

## Plugin API

Plugins implement the `ContractKitPlugin` interface and are loaded by the CLI based on the `plugins` map in `contractkit.config.json`.

```typescript
import type { ContractKitPlugin, PluginContext, CkRootNode } from '@contractkit/core';

export function createMyPlugin(options: MyOptions = {}): ContractKitPlugin {
    return {
        name: 'my-plugin',

        // Optional: mutate the AST per file before validation.
        transform(root: CkRootNode, ctx: PluginContext) {
            // ...
        },

        // Optional: throw to fail compilation.
        validate(root: CkRootNode, ctx: PluginContext) {
            // ...
        },

        // Required: emit output files. Called once with all parsed roots.
        async generateTargets(roots: CkRootNode[], ctx: PluginContext) {
            for (const root of roots) {
                ctx.emitFile('relative/path.ts', '// generated');
            }
        },

        // Optional: register a `contractkit <name>` CLI subcommand.
        command: {
            name: 'my-plugin',
            description: 'Does plugin-specific work',
            run: async (argv) => { /* ... */ },
        },
    };
}
```

`PluginContext` exposes `options`, `rootDir`, `cacheDir`, `cacheEnabled`, and `emitFile`. `cacheEnabled` is `false` when the user passes `--force` or sets `cache: false`; plugins that maintain incremental-build state should bypass it then. `cacheDir` is the absolute path to the CLI's build-cache directory (default `<rootDir>/.contractkit/cache`) — plugins should persist their manifests there rather than mixing them with output files.

### Incremental codegen helper

Plugins that emit many files (one per operation, one per contract root, etc.) can opt into per-output caching via `runIncrementalCodegen`. The plugin defines cacheable "units" with a stable `key` and `fingerprint`; on subsequent runs, units whose fingerprint matches the persisted manifest skip their renderer entirely. Files in the prior manifest that aren't produced this run are reported in `deletedPaths` so the plugin can clean them up. The manifest is returned separately from `filesToWrite` so plugins can persist it under `ctx.cacheDir` rather than alongside their outputs.

```typescript
import {
    runIncrementalCodegen,
    parseIncrementalManifest,
    serializeIncrementalManifest,
    emptyIncrementalManifest,
    hashFingerprint,
    type IncrementalManifest,
} from '@contractkit/core';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const manifestPath = resolve(ctx.cacheDir, 'my-plugin-manifest.json');
const prev: IncrementalManifest = ctx.cacheEnabled && existsSync(manifestPath)
    ? parseIncrementalManifest(readFileSync(manifestPath, 'utf-8'))
    : emptyIncrementalManifest('1');

const result = runIncrementalCodegen({
    codegenVersion: '1', // bump to bust every per-unit cache
    prevManifest: prev,
    globalFiles: [/* always-regenerated outputs */],
    units: roots.map(root => ({
        key: root.file,
        fingerprint: hashFingerprint({ root, options: ctx.options }),
        render: () => [{ relativePath: outPathFor(root), content: render(root) }],
    })),
    fileExists: relPath => existsSync(resolve(outDir, relPath)),
});

deleteFromDisk(result.deletedPaths);
for (const f of result.filesToWrite) ctx.emitFile(resolve(outDir, f.relativePath), f.content);

// Persist the manifest under the CLI cache dir.
mkdirSync(ctx.cacheDir, { recursive: true });
writeFileSync(manifestPath, serializeIncrementalManifest(result.manifest), 'utf-8');
```

Companion helpers: `hashFingerprint(value)` for stable sha256 hashing, `stableStringify(value)` for deterministic JSON (handles bigint and undefined), `collectTransitiveModelRefs(seedTypes, modelMap)` for slicing cross-file model dependencies into per-unit fingerprints.

### Per-operation plugin files

An operation can declare `plugins: { name: "path.yml" }` in the source. The CLI resolves each path relative to the operation's `.ck` file and stores the content on the AST as `op.pluginFiles[name]` before plugins run. A plugin keyed by its own `name` can read its entry to override or augment generated output:

```typescript
async generateTargets(roots, ctx) {
    for (const root of roots) {
        for (const route of root.routes) {
            for (const op of route.operations) {
                const override = op.pluginFiles?.['my-plugin'];
                if (override) {
                    ctx.emitFile(targetPath(op), override);
                    continue;
                }
                // ... normal generation
            }
        }
    }
}
```

The raw paths from the grammar are still available on `op.plugins` for round-trip use cases (e.g. the prettier plugin); `op.pluginFiles` is set only by the CLI resolver, never by the parser.

## Programmatic parsing

```typescript
import { parseCk, Diagnostics, applyOptionsDefaults } from '@contractkit/core';
import { readFileSync } from 'node:fs';

const diag = new Diagnostics();
const source = readFileSync('./contracts/payments.ck', 'utf8');
const root = parseCk(source, 'payments.ck', diag);

if (diag.hasErrors()) {
    diag.print();
    process.exit(1);
}

applyOptionsDefaults(root);
// `root` is now a fully-normalized `CkRootNode` ready for codegen.
```

## Source layout

| Path | Purpose |
| --- | --- |
| `src/contractkit.ohm` | PEG grammar — source of truth for the language |
| `src/grammar.ts` / `src/semantics.ts` | Compiled grammar loader + Ohm parse tree → AST |
| `src/parser.ts` | `parseCk` entry point |
| `src/ast.ts` | All AST node types |
| `src/type-builders.ts` / `src/type-utils.ts` | AST construction and type-graph helpers |
| `src/decompose.ts` | Splits a parsed file into per-decl groups (cache fingerprinting, codegen) |
| `src/apply-options-defaults.ts` | Options-level header globals merge |
| `src/content-type.ts` | Content-type parsing/normalization |
| `src/diagnostics.ts` | Error/warning collector |
| `src/validate-refs.ts` / `src/validate-inheritance.ts` / `src/validate-operation.ts` | Validation passes |
| `src/plugin.ts` | `ContractKitPlugin` and `PluginContext` interface types |
| `src/incremental.ts` | Shared per-output caching helper (`runIncrementalCodegen`, manifest types) used by Bruno / Python / TypeScript plugins |
