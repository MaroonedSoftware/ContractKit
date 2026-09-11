---
'@contractkit/plugin-typescript': patch
---

An intersection with a `format()` model as a member now compiles and validates, in a router's `query:`, `headers:` and `params:` blocks, in request and response bodies, and in model fields and aliases.

A model such as `contract format(input=snake) SnakeFilter: { fromDate?: date }` compiles to a `ZodPipe`, which has neither `.extend()` nor `.shape`. An intersection `SnakeFilter & { q: string }` was emitted as `SnakeFilter.extend({ q: z.string() })`, and `Plain & SnakeFilter` as `Plain.extend(SnakeFilter.shape)`, both of which failed `tsc` with TS2339.

The object is now built from the member's own object, `SnakeFilter.in`, and ends in one transform that hands the member's keys to its own `SnakeFilter.out` and passes every other key through. A request block's mode goes on the object, before the transform:

```ts
SnakeFilter.in.extend({ q: z.string() }).strict().transform(({ from_date: _0, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0 }),
}))
```

So the router parses `from_date` and `q`, the keys the SDK already sent for this intersection, and the service receives `{ fromDate, q }`. An alias of such an intersection (`contract Scoped: SnakeFilter & Scope`) is a pipe itself, and a block that references it is validated as `Scoped.in.strict().pipe(Scoped.out)`. A `headers:` intersection copies a camelCase header over from its lowercase key by the name the object parses, so a `format(input=snake)` member's keys are no longer copied under their camelCase names. An intersection without a `format()` member is emitted exactly as before.

The cache fingerprint of every router and Zod schema file now covers the `format()` models it reads through and the keys each one parses, so a model in another `.ck` file gaining `format()` or a field regenerates the files that intersect it.
