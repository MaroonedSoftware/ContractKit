---
name: ck-language
description: Semantics of the ContractKit `.ck` language. Contract and field modifiers, multi-base inheritance, Zod schema shapes, scalars and their wire forms (`decimal`, `bigint`, `date`), discriminated unions, unknown enum tolerance, route modifiers and the security cascade, webhook signatures, the `mcp` field (`exclude`, hints, `ui`), the response block (which statuses the service produces, several content types per status, the `(documented)` modifier, `text/event-stream` Server-Sent Events, response headers), options-level header globals, and variable substitution. Use when reading, writing, or changing `.ck` files, the AST, or any code that interprets these constructs.
---

# The `.ck` language

The grammar in `packages/contractkit/src/contractkit.ohm` is the source of truth for
syntax; this skill covers the *semantics* the grammar doesn't tell you. `docs/language.md` is the
user-facing reference for every construct.

```
options {
    keys: { area: payments }
    services: { PaymentsService: "#src/services/payments.service.js" }
    security: { policy: paymentsWrite }
}

# A payment record
contract Payment: {
    id: readonly uuid
    amount: decimal(min=0, scale=2)
    currency: string(len=3)
    status: enum(pending, completed, failed) = pending
    metadata?: record(string, string)
    createdAt: readonly datetime
}

operation(internal) /payments/{id}: {
    params: { id: uuid }

    get: {
        sdk: getPayment
        name: Get Payment
        service: PaymentsService.getById
        response: {
            200: { application/json: Payment }
            404:
        }
    }
}
```

`name:` takes bare text to the end of the line. Quotes are not syntax there: `name: "Get Payment"`
keeps them as part of the name.

Terminology is `contract` and `operation` throughout — source files, test files, and
describe blocks all follow it (`codegen-contract.ts`, `generateContract`).

## Reference files

Read the one that covers what you're touching; don't read all of them.

| File | Covers |
| ---- | ------ |
| `references/models.md` | Contract + field modifiers, nullability, multi-base inheritance, Zod schema shapes, discriminated unions, enums and unknown values, scalar types and wire forms |
| `references/operations.md` | Route modifiers, the security cascade, signatures, the `mcp` field, which responses the service produces, several mimes per status, content-type categories, Server-Sent Events, response headers, options-level header globals |
| `references/variables.md` | `{{name}}` substitution, lookup order, escaping, built-ins |

## Pass ordering (a recurring source of bugs)

`applyOptionsDefaults` and `applyVariableSubstitution` run **in the CLI**, between
`parseCk` and `decomposeCk` — deliberately *not* inside `parseCk`. The prettier plugin
calls `parseCk` directly and needs the un-merged, un-substituted AST to round-trip a
file. Putting a normalization pass inside the parser silently breaks the formatter.

Plugin `validate` and `transform` hooks run after both passes, so they see merged headers and
substituted strings. The full order is in the `ck-plugins` skill.
