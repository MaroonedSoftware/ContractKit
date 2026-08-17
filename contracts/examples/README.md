# Example contracts

Complete, realistic APIs rather than snippets. Each file is written the way you would actually
write it: doc comments on the models, constrained fields, an error type shared across responses,
and security declared where it belongs.

Everything here is compiled and validated as a single project by
`packages/contractkit/tests/example-contracts.test.ts`, which tolerates neither errors nor
warnings. The figures in the [README](../../README.md) and the docs are rendered from these files,
so what you read in the documentation is what the compiler accepts.

| File | Domain | Constructs it exercises |
| --- | --- | --- |
| [`billing/subscriptions.ck`](billing/subscriptions.ck) | Plans and subscriptions | Constrained scalars, enum defaults, `readonly` fields, an idempotency header, a `409(documented)` the service never returns, and a PDF response beside a JSON API |
| [`commerce/catalog.ck`](commerce/catalog.ck) | Product catalog | `security: none` for public reads, cursor pagination, `cache-control` / `etag` response headers with a `304`, an inline `patch` body, and an MCP-exposed search tool with hints |
| [`commerce/orders.ck`](commerce/orders.ck) | Orders and refunds | A discriminated union over payment methods, nested inline object arrays, file-level request and response headers, and references to models declared in `catalog.ck` |
| [`commerce/webhooks.ck`](commerce/webhooks.ck) | Inbound webhooks | HMAC `signature:` in both its bare and block forms, `security: none`, headers by type reference, `unknown` bodies |
| [`identity/auth.ck`](identity/auth.ck) | Sessions and users | Multi-base inheritance, `writeonly` passwords, per-route security policies, `{{variable}}` substitution, and an `operation(internal)` admin route |

`../test.ck` is the Petstore API, kept as a broad smoke test of the language.

## Reading them in order

If you are new to the language, `billing/subscriptions.ck` is the one to start with — it is a
single file, uses no cross-file references, and covers most of what you need for a real API. Then
read `commerce/` as a set: three files that share models and headers, which is what a real project
looks like once it outgrows one file.

## Using them

They are not wired to a `contractkit.config.json`, because the service paths (`#modules/...`) and
the policy names point at an application that does not exist here. To compile them against your
own project, copy a file, then change:

- the `services:` import paths to your modules,
- the `policy:` names to your auth policies,
- the `signature:` keys to HMAC schemes in your config.
