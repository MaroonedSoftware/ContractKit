---
'@contractkit/plugin-typescript': patch
---

A generated SDK client now imports every model reviver its inline response wrappers call.

A response body with no `reviveX` of its own, such as an intersection `Invoice & { note: string }` or an inline object `{ invoice: Invoice }`, is rehydrated through a local `__revive…` wrapper, which calls `reviveInvoice` for the model it holds. The client decided its reviver imports from its method bodies alone, where only the wrapper's name appears, so the client failed `tsc` with TS2304 ("Cannot find name 'reviveInvoice'"). Top-level clients and area clients both read the wrappers now.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `10`, so an existing incremental cache regenerates its output.
