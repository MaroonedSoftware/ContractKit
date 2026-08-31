/**
 * The emitted decimal.js runtime shared by every generator that renders a `decimal` scalar.
 *
 * `_ZodBinary`/`_ZodDatetime`/`_ZodInterval` are duplicated as literals across codegen-contract,
 * codegen-operation and codegen-mcp, and have already drifted once (the three files emit their
 * luxon import lists in two different orders). The decimal runtime is defined once here so the
 * three call sites cannot disagree about it; each still decides *whether* to emit it with its own
 * detection strategy, which is the part that legitimately differs between them.
 */

/**
 * The decimal.js import — **named, not default**.
 *
 * `decimal.d.ts` declares `Decimal` three times over: a class, a namespace, and a function, with
 * `export default Decimal` alongside. Under the `NodeNext` resolution the scaffolded SDK uses
 * (`module: NodeNext` + `"type": "module"`), the default export resolves to the *namespace*
 * meaning, so `import Decimal from 'decimal.js'` fails to compile with "Cannot use namespace
 * 'Decimal' as a type" and "Property 'set' does not exist". The named import binds the merged
 * class and is the only form that typechecks.
 */
export const DECIMAL_IMPORT = `import { Decimal } from 'decimal.js';`;

/**
 * Global decimal.js configuration, emitted in **every** file that imports `Decimal` — plain-types
 * mode included, where there is no Zod schema but `String(value)` and `JSON.stringify` still run.
 *
 * Load-bearing, not cosmetic. decimal.js switches to exponential
 * notation outside `toExpNeg`/`toExpPos` (defaults -7/21), so without it `new Decimal('0.00000001')`
 * serializes as `"1e-8"` and any peer validating `^-?\d+(\.\d+)?$` rejects it. It is the only lever
 * that reaches the `JSON.stringify` Koa runs over `ctx.body`, which we do not otherwise control.
 *
 */
export const DECIMAL_CONFIG_LINE = `Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });`;

/**
 * The Zod schema for a `decimal`.
 *
 * Deliberately has no output `.transform()`. `isRevalidatable` in codegen-operation treats every
 * scalar as idempotent under re-parse — the assumption `server.validateResponses` rests on — and
 * preprocess passes an already-`Decimal` value through untouched, so it holds.
 *
 * A raw JSON number fails validation rather than being coerced: by the time one reaches us it has
 * already been through an IEEE-754 double, which is the loss this scalar exists to prevent. Bad
 * strings are returned unchanged from preprocess rather than throwing, so they surface as an
 * ordinary Zod issue instead of a `DecimalError` escaping the parse.
 */
export const DECIMAL_ZOD_SCHEMA_LINE = `const _ZodDecimal = z.preprocess((val) => { if (typeof val !== 'string') return val; try { return new Decimal(val); } catch { return val; } }, z.custom<Decimal>((val) => Decimal.isDecimal(val), { message: 'Must be an exact decimal sent as a quoted string, e.g. "1250.00"' }));`;

/** The decimal runtime for a file that also holds Zod schemas, in emission order. */
export const DECIMAL_PRELUDE_LINES: readonly string[] = [DECIMAL_CONFIG_LINE, DECIMAL_ZOD_SCHEMA_LINE];
