---
name: ck-language
description: Semantics of the ContractKit `.ck` language — contract/field modifiers, multi-base inheritance, Zod schema shapes, discriminated unions, the `mcp` field, response headers, options-level header globals, variable substitution, and scalar types. Use when reading, writing, or changing `.ck` files, the AST, or any code that interprets these constructs.
---

# The `.ck` language

The grammar in `packages/contractkit/src/contractkit.ohm` is the source of truth for
syntax; this skill covers the *semantics* the grammar doesn't tell you.

```
options {
    keys: { area: payments }
    services: { PaymentsService: "#src/services/payments.service.js" }
    security: { policy: paymentsWrite }
}

# A payment record
contract Payment: {
    id: readonly uuid
    amount: number(min=0)
    currency: string(len=3)
    status: enum(pending, completed, failed) = pending
    metadata?: record(string, string)
    createdAt: readonly datetime
}

operation(internal) /payments/{id}: {
    params: { id: uuid }

    get: {
        sdk: getPayment
        name: "Get Payment"
        service: PaymentsService.getById
        response: {
            200: { application/json: Payment }
            404:
        }
    }
}
```

Terminology is `contract` and `operation` throughout — source files, test files, and
describe blocks all follow it (`codegen-contract.ts`, `generateContract`).

## Reference files

Read the one that covers what you're touching; don't read all of them.

| File | Covers |
| ---- | ------ |
| `references/models.md` | Contract + field modifiers, multi-base inheritance, Zod schema shapes, discriminated unions, scalar types |
| `references/operations.md` | The `mcp` field, response headers, options-level header globals |
| `references/variables.md` | `{{name}}` substitution, lookup order, escaping, built-ins |

## Pass ordering (a recurring source of bugs)

`applyOptionsDefaults` and `applyVariableSubstitution` run **in the CLI**, between
`parseCk` and `decomposeCk` — deliberately *not* inside `parseCk`. The prettier plugin
calls `parseCk` directly and needs the un-merged, un-substituted AST to round-trip a
file. Putting a normalization pass inside the parser silently breaks the formatter.
