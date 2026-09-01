---
'@contractkit/plugin-typescript': minor
'@contractkit/core': minor
---

Derive valid identifiers from path parameter names, so a hyphenated path param generates code that works.

`operation /invoices/{invoice-id}` is a legal contract — the grammar's `identPart` admits `-` and `.` — but it is not a valid TypeScript identifier, and every TypeScript generator used the contract's spelling directly:

```ts
HyphenatedRouter.get('/invoices/{invoice-id}', requirePolicy(), async ctx => {
    const { invoice-id } = await parseAndValidate(ctx.params, ...);
```

Three separate failures in those two lines. The route pattern kept the braces, so Koa registered a literal path no request could match. The destructuring did not parse. And the SDK emitted `async getInvoice(invoice-id: string)`, which did not parse either.

Names the generated code has to *bind* are now mapped through `toIdentifier`, so `invoice-id` becomes `invoiceId`:

- **Router** — the Koa pattern becomes `/invoices/:invoiceId`, the params schema is keyed to match (that is what `ctx.params` carries), and the service call passes the bound name.
- **SDK** — the method parameter and the URL interpolation use the identifier.
- **MCP** — the tool's input schema and the handler's destructuring use it.

**Nothing on the wire changes.** A path placeholder's name never reaches the client: Koa matches by position, so `GET /invoices/abc123` behaves exactly as before. That is what makes the rename safe, and it is the reason query parameters, headers and OpenAPI parameters are deliberately *not* renamed — those names are what the client actually sends, or must match a path template the same document declares.

`toIdentifier` returns its input unchanged whenever it is already an identifier, so no existing generated output moves. It lives in core next to the path-parameter pattern, because the Bruno plugin needs the same mapping for its own `:variable` syntax.
