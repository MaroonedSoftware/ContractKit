# @contractkit/contractkit-plugin-markdown

ContractKit plugin that generates a Markdown API reference from `.ck` contract and operation files.

## Installation

```bash
pnpm add @contractkit/contractkit-plugin-markdown
```

## Configuration

```json
{
  "plugins": {
    "@contractkit/contractkit-plugin-markdown": {
      "output": "docs/api-reference.md"
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for the output file |
| `output` | `string` | `"api-reference.md"` | Output file path |

## Output

The plugin writes a single Markdown file documenting all contracts and operations discovered across all `.ck` source files.

**Contracts** are documented as data model references: field names, types, modifiers (`readonly`, `writeonly`, `optional`, `deprecated`), and default values.

**Operations** are documented as endpoint references: HTTP method, path, path/query parameters, request body, and response codes with their content types and schemas.

## Programmatic use

```typescript
import { createMarkdownPlugin } from '@contractkit/contractkit-plugin-markdown';

const plugin = createMarkdownPlugin({
  output: 'docs/api-reference.md',
});
```
