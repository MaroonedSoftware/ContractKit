# @contractkit/plugin-python

ContractKit plugin that generates a Python SDK from `.ck` contract and operation files. Produces [Pydantic v2](https://docs.pydantic.dev/latest/) models and [httpx](https://www.python-httpx.org/)-based client classes.

## Installation

```bash
pnpm add @contractkit/plugin-python
```

## Configuration

```json
{
  "plugins": {
    "@contractkit/plugin-python": {
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

A method returns its body directly when the operation has one response a caller can receive. When it has several, the return type is a union of per-status `TypedDict`s keyed on a `Literal` status, and when one status declares several content types the result carries the `content_type` that actually came back.

### Aggregator (`__init__.py`)

The aggregator class (named from `packageName`) instantiates all client classes and exposes them as attributes. Pass the base URL and optional headers at construction time:

```python
from python_sdk import AcmeSdk

sdk = AcmeSdk(base_url="https://api.acme.com", headers={"Authorization": "Bearer ..."})
payment = sdk.payments.get_payment(id="pay_123")
```

### Base client (`_base_client.py`)

Provides `BaseClient` (wraps `httpx.Client`) and `SdkError`. All generated client classes inherit from `BaseClient`.

`SdkError` is raised for any response at or above 400 **except** the statuses an operation declares as values, which each method passes as `expect_statuses`. A `304` produced by conditional-GET middleware, or an error status the service returns deliberately, therefore comes back as a normal return value rather than an exception.

## Runtime dependencies

The generated SDK requires:

```
pydantic>=2.0
httpx
```

## Programmatic use

```typescript
import { createPythonSdkPlugin } from '@contractkit/plugin-python';

const plugin = createPythonSdkPlugin({
  baseDir: 'sdks/python',
  packageName: 'acme',
});
```
