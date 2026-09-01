---
'@contractkit/plugin-typescript': minor
---

Reject non-string JSON values for numeric scalars, instead of silently turning them into numbers.

`number` and `int` compiled to `z.coerce.number()`, which is `Number(v)`. That accepts far more than a number: `[]` and `""` become `0`, `null` becomes `0`, `true` becomes `1`. So `{"quantity": []}` validated cleanly and the handler ran on a value the client never sent.

The coercion is now narrowed to the case that motivates it:

```ts
z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
```

A non-empty string still converts, because query strings and headers arrive as text and a JSON body carrying `"42"` is common enough that rejecting it would break working callers. Everything else is handed to `z.number()`, which judges it.

This is the shape the `boolean` scalar already had: its preprocess maps only the two literal strings and passes everything else through to `z.boolean()`. It needed no change.

Constraints move inside the preprocess — `z.preprocess(…, z.number().min(1))` rather than `.min(1)` on the outside — because `z.preprocess` returns a `ZodPipe`, which has no `.min()`. The `bigint` scalar already did it this way.

### What this breaks

`{"petId": []}`, `{"n": null}` and `{"n": true}` now get a 400 where they previously validated as `0`, `0` and `1`. Frame this as the fix it is: those requests were being accepted and acted on with a value the caller did not send. String-shaped numbers still coerce, so query parameters and headers are unaffected.

Not addressed here: the JSON-versus-string wire split. `XInput` is a single exported `const` reused for both `query: X` and `request: { application/json: X }`, so a truly strict body schema needs a second emitted variant plus import plumbing. `renderInputScalar` remains the documented seam for that, with its docstring corrected — it claimed to coerce from string input while being a pure passthrough.
