# @maroonedsoftware/contractkit-plugin-python-sdk

ContractKit plugin that generates a Python SDK from `.ck` contract and operation files. Produces [Pydantic v2](https://docs.pydantic.dev/latest/) models and [httpx](https://www.python-httpx.org/)-based client classes.

## Installation

```bash
pnpm add @maroonedsoftware/contractkit-plugin-python-sdk
```

## Configuration

```json
{
  "plugins": {
    "@maroonedsoftware/contractkit-plugin-python-sdk": {
      "baseDir": "python-sdk",
      "packageName": "acme"
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `"python-sdk"` | Output directory relative to rootDir |
| `packageName` | `string` | `"Sdk"` | Name used for the aggregator SDK class |

## Output structure

```
python-sdk/
├── __init__.py          # SDK aggregator class + __all__ exports
├── _base_client.py      # Shared BaseClient and SdkError classes
├── _models_<name>.py    # Pydantic v2 models (one file per .ck contract file)
├── _client_<name>.py    # httpx client class (one file per .ck operation file)
└── requirements.txt     # Runtime dependencies (httpx, pydantic>=2.0)
```

### Models (`_models_*.py`)

Each `contract` declaration becomes a Pydantic v2 `BaseModel`. Contracts that have `readonly` or `writeonly` fields produce separate Input variants following the same rules as the TypeScript plugin:

- **`Model`** — read model (no writeonly fields)
- **`ModelInput`** — input model (no readonly fields)

### Clients (`_client_*.py`)

Each operation file with at least one public operation generates a client class. Methods correspond to HTTP verbs and are named from the `sdk:` field in the `.ck` source. Request and response bodies are typed with the generated Pydantic models.

### Aggregator (`__init__.py`)

The aggregator class (named from `packageName`) instantiates all client classes and exposes them as attributes. Pass the base URL and optional headers at construction time:

```python
from python_sdk import AcmeSdk

sdk = AcmeSdk(base_url="https://api.acme.com", headers={"Authorization": "Bearer ..."})
payment = sdk.payments.get_payment(id="pay_123")
```

### Base client (`_base_client.py`)

Provides `BaseClient` (wraps `httpx.Client`) and `SdkError` (raised on non-2xx responses). All generated client classes inherit from `BaseClient`.

## Runtime dependencies

The generated SDK requires:

```
pydantic>=2.0
httpx
```

## Programmatic use

```typescript
import { createPythonSdkPlugin } from '@maroonedsoftware/contractkit-plugin-python-sdk';

const plugin = createPythonSdkPlugin({
  baseDir: 'sdks/python',
  packageName: 'acme',
});
```
