---
'@contractkit/plugin-typescript': patch
---

Fix `@deprecated` being dropped from generated SDK methods that also have a description.

The SDK emitted the deprecation as its own block, immediately above the block carrying `@name`, `@description` and `@throws`:

```ts
/** @deprecated */
/** @description look up a refund by its originating payment */
async getRefund(params: PaymentRef): Promise<Payment> {
```

TypeScript associates only the JSDoc comment *adjacent* to a declaration, so the deprecation was invisible to editors and to `tsc` whenever the operation also had a description or an error contract, which is the common case. It survived only on operations that had nothing else to document.

`@deprecated` is now a tag inside the one block, in the same position the Koa router already puts it:

```ts
/**
 * @description look up a refund by its originating payment
 * @deprecated
 */
```

No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.
