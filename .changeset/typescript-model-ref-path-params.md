---
'@contractkit/plugin-typescript': patch
---

Fix generated SDK methods failing to compile when a route declares its path params as a model.

`buildUrlExpression` accepted a `ParamSource` and discarded it, always interpolating the placeholder by bare name. That is right for a `params { … }` block, whose fields `buildMethodParams` spreads across the signature — but for `params: PaymentRef` the signature has a single argument called `params`, so the emitted URL named something that does not exist:

```ts
async getRefund(params: PaymentRef): Promise<Payment> {
    const result = await this.fetch(`/refunds/${encodeURIComponent(paymentId)}`, { method: 'GET' });
```

`TS2304`, plus `TS6133` for the now-unread `params`. This is the same root cause as the Python `NameError`: the name in the path and the name in the signature come from different places and were never reconciled.

The value is now read off the argument, as `params.paymentId`. A placeholder that is not a valid property accessor uses bracket notation, and the expression is wrapped in `String(...)` because a model's field may be typed something `encodeURIComponent` does not accept.

The spread-param branch is deliberately unchanged, including for a placeholder that is not a valid identifier. There the expression has to name a signature parameter, and `buildMethodParams` uses the contract's spelling verbatim — so when that spelling is not an identifier the method is already unsalvageable, and emitting an expression that parses as arithmetic would be no improvement over leaving the placeholder alone.

No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.
