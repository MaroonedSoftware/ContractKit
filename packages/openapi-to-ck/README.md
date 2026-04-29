# @contractkit/openapi-to-ck

Convert OpenAPI specs (2.0, 3.0, 3.1) into ContractKit `.ck` files. Useful for adopting ContractKit in projects that already have an OpenAPI document, or for round-tripping a spec through CK.

## Installation

```bash
pnpm add -D @contractkit/openapi-to-ck
```

## Use as a CLI subcommand

When the package is installed, the `@contractkit/cli` binary picks up an `openapi-to-ck` subcommand:

```bash
contractkit openapi-to-ck --input openapi.yaml --output contracts/
```

| Flag | Description |
| --- | --- |
| `--input <path>` | Path to an OpenAPI YAML or JSON file. |
| `--output <dir>` | Directory to write `.ck` files into. |
| `--split <single \| by-tag>` | Output mode. `by-tag` (default) writes one file per OpenAPI tag; `single` writes one combined file. |
| `--no-comments` | Don't emit OpenAPI descriptions as `#` comments. |

## Programmatic use

```typescript
import { convertOpenApiToCk } from '@contractkit/openapi-to-ck';

const { files, warnings } = await convertOpenApiToCk({
    input: 'openapi.yaml',          // file path, JSON/YAML string, or pre-parsed object
    split: 'by-tag',                // 'single' | 'by-tag'  (default: 'by-tag')
    includeComments: true,          // emit OpenAPI descriptions as # comments (default: true)
    onWarning: w => console.warn(w),
});

// `files` is a Map<filename, ckSource>
for (const [filename, source] of files) {
    await fs.writeFile(filename, source);
}
```

`Warning` entries carry a JSON-pointer-style `path` into the OpenAPI spec, a human-readable `message`, and a `severity` of `'info' | 'warn'`.

## What's converted

| OpenAPI | `.ck` |
| --- | --- |
| `paths` | `operation /path: { ... }` blocks |
| `components.schemas` | `contract Name: { ... }` declarations |
| `parameters` (path / query / header) | `params: { ... }` / `query: { ... }` / `headers: { ... }` blocks |
| `requestBody.content[mime].schema` | `request: { mime: Type }` |
| `responses[code].content[mime].schema` | `response: { code: { mime: Type } }` |
| `responses[code].headers` | per-status `headers: { name: type }` |
| `allOf` | `&` intersection on `contract` declarations |
| `oneOf` + `discriminator` | `discriminated(by=field, A \| B)` |
| `oneOf` / `anyOf` (no discriminator) | `\|` union |
| `enum`, `pattern`, `minimum/maximum`, `minLength/maxLength` | type constraint args |

## Other exports

For tools that want to operate on the intermediate AST rather than emit `.ck` source:

```typescript
import {
    schemasToModels,        // OpenAPI schemas → ContractKit ModelNode[]
    pathsToRoutes,          // OpenAPI paths   → ContractKit OpRouteNode[]
    splitByTag,             // group routes by OpenAPI tag
    mergeIntoSingle,        // collapse roots into one
    detectCircularRefs,     // find $ref cycles
    extractRefName,         // "#/components/schemas/Foo" → "Foo"
    sanitizeName,           // turn an arbitrary string into a valid CK identifier
    normalize,              // upgrade 2.0/3.0 → 3.1 + dereference
    astToCk,                // ContractKit AST → `.ck` source string
    serializeType,          // ContractTypeNode → `.ck` type expression
} from '@contractkit/openapi-to-ck';
```
