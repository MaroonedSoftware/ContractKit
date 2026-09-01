---
'@contractkit/plugin-python': patch
---

Fix generated Python SDK methods raising `NameError` on every path parameter whose contract name is not already snake_case.

`buildUrlExpression` interpolated the placeholder exactly as written in the contract, while `buildMethodParams` snake_cases it for the signature. A route declaring `{paymentId}` produced:

```python
async def get_payment(self, payment_id: UUID) -> Payment:
    result = await self._fetch(f"/payments/{paymentId}", method="GET")
```

The module imports cleanly and the call raises `NameError: name 'paymentId' is not defined`, which is why `ast.parse` never caught it. The URL now interpolates the name the signature actually binds.

Two related cases are fixed with it:

- **Placeholders that are not Python identifiers.** The old pattern matched only `[a-zA-Z_]\w*`, so `{payment-id}` was left alone, no f-string was produced at all, and the literal braces went out on the wire. The pattern now covers what the `.ck` grammar allows, where `identPart` admits `-` and `.`.
- **Path params declared as a model.** When a route says `params: PaymentRef`, the method takes a single `params` argument, so the value is read as `params.payment_id`.

Path values are also percent-encoded now, via `urllib.parse.quote` with `safe=''` so that a `/` inside a value cannot forge a path segment. Nothing encoded them before, while the TypeScript SDK has always used `encodeURIComponent`. The import is emitted only when a route actually interpolates something.

`PYTHON_CODEGEN_VERSION` is bumped to `2`, so a warm `.contractkit/cache` does not preserve the broken clients across an upgrade.

Visible in diffs but not breaking: URLs that were already correct gain percent-encoding.
