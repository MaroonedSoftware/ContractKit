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
├── _enums.py           # UNKNOWN, the value an enum reads a member it does not know into
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

A JSON response is validated against its declared type, so a method returns the Python type it is annotated with. A single model goes through `model_validate`. Any other type (a list, record, tuple or union, or one holding a `bigint`, `date` or `Decimal`) goes through a module-level `TypeAdapter` built once at import. A response that does not match raises `pydantic.ValidationError`. Text and binary responses are returned as `str` and `bytes`.

A `decimal` field is typed `ExactDecimal` from `_scalars.py`: a `decimal.Decimal` that reads only plain digits (the OpenAPI `pattern`, so not `"1e5"`, `"NaN"` or a float) and writes them back in plain digits, where `str()` would send `0.00000001` as `"1E-8"`. Building a model with a `Decimal` or an `int` still works.

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

## Enums

A service that adds an enum member must not break an older client, so every generated enum reads a
wire value the SDK does not know as `UNKNOWN` instead of failing validation. The rest of the
payload reads as normal.

```python
Rating = Annotated[Literal["good", "neutral", "bad"] | UnknownValue, ReadsUnknown]
```

A known value is still its plain string, so `tally.rating == "good"` and building a model or a
query from strings work as before. `UNKNOWN` is the single member of the `UnknownValue` enum, and
both are exported from the package. Compare with `is`, which narrows the type to the known members
for a type checker:

```python
from python_sdk import UNKNOWN

if tally.rating is UNKNOWN:
    ...  # a member added after this SDK was generated
else:
    handle(tally.rating)  # Literal["good", "neutral", "bad"]
```

`ReadsUnknown` gives the members of the type the first chance at a value, and only a string none
of them claims becomes `UNKNOWN`. A value that is not a string is still rejected. This works the
same in a nullable field, a list, a dict key and a query parameter.

`UNKNOWN` has no wire spelling, so sending it raises `pydantic_core.PydanticSerializationError`
rather than sending something the service never defined. That covers a request body as well as a
path, query, header or form value. Dumping a model in Python mode (`model_dump()`) keeps it as it
is.

In a plain union, an enum member only claims a string it lists, so a later `str` member still gets
one it does not (`Literal["open", "closed"] | str`). When no member takes every string, a string no
member claims reads as `UNKNOWN` (`Annotated[Literal["open", "closed"] | int | UnknownValue, ReadsUnknown]`).
A named enum in such a union is written out as its values, since its own annotation would claim
every string.

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
