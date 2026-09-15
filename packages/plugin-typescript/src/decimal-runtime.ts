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
 * Global decimal.js configuration, emitted in every **server-side** file that imports `Decimal`:
 * routers, MCP servers, server schemas and plain types. SDK files use {@link SDK_DECIMAL_CLONE_LINE}
 * instead.
 *
 * Load-bearing, not cosmetic. decimal.js switches to exponential
 * notation outside `toExpNeg`/`toExpPos` (defaults -7/21), so without it `new Decimal('0.00000001')`
 * serializes as `"1e-8"` and any peer validating `^-?\d+(\.\d+)?$` rejects it. It is the only lever
 * that reaches the `JSON.stringify` Koa runs over `ctx.body`, which we do not otherwise control:
 * the handler builds those values with its own `Decimal`, not one of ours.
 *
 */
export const DECIMAL_CONFIG_LINE = `Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });`;

/** The name of the SDK's private decimal.js constructor. */
export const SDK_DECIMAL_NAME = '__Decimal';

/**
 * The SDK's private decimal.js constructor, which every `Decimal` the SDK builds comes from.
 *
 * An SDK is a library, so it must not do what {@link DECIMAL_CONFIG_LINE} does: `Decimal.set`
 * changes the one constructor the SDK shares with the rest of the consumer's app, and every
 * `Decimal` the consumer makes starts printing differently the moment they import the client. A
 * clone carries its own settings, and an instance reads them off its own constructor, so a revived
 * value still prints in plain digits while the consumer's `Decimal` keeps whatever they gave it.
 *
 * The SDK needs nothing more than this. Its own values are the only ones it prints, and a request
 * body is written with `toFixed()`, which never uses exponential notation (see codegen-serialize).
 *
 * `defaults: true` makes the clone start from decimal.js's defaults rather than copying whatever
 * the shared constructor holds when the SDK module loads, which would depend on import order. So
 * arithmetic on a revived value runs at decimal.js's default precision whatever the app has set.
 * Values from the two constructors still mix freely: a clone shares the original's prototype, so
 * `instanceof Decimal`, `Decimal.isDecimal` and arithmetic accept either.
 */
export const SDK_DECIMAL_CLONE_LINE = `const ${SDK_DECIMAL_NAME} = Decimal.clone({ defaults: true, toExpNeg: -9e15, toExpPos: 9e15 });`;

/**
 * The clone declaration for a file whose `lines` build a `Decimal` through it, or nothing.
 *
 * Read off the emitted text, like the coercion helpers, so the declaration cannot drift from its
 * uses and leave an unused local or an undeclared name behind.
 */
export function sdkDecimalCloneFor(lines: readonly string[]): string[] {
    return lines.some(l => l.includes(`new ${SDK_DECIMAL_NAME}(`)) ? [SDK_DECIMAL_CLONE_LINE] : [];
}

/**
 * The Zod schema for a `decimal`, building values with the constructor named `ctor`.
 *
 * Deliberately has no output `.transform()`. `isRevalidatable` in codegen-operation treats every
 * scalar as idempotent under re-parse — the assumption `server.validateResponses` rests on — and
 * preprocess passes an already-`Decimal` value through untouched, so it holds.
 *
 * A raw JSON number fails validation rather than being coerced: by the time one reaches us it has
 * already been through an IEEE-754 double, which is the loss this scalar exists to prevent. Bad
 * strings are returned unchanged from preprocess rather than throwing, so they surface as an
 * ordinary Zod issue instead of a `DecimalError` escaping the parse.
 *
 * The check stays `Decimal.isDecimal` in both forms, so a value built with the consumer's own
 * `Decimal` passes an SDK schema too.
 */
function decimalZodSchemaLine(ctor: string): string {
    return `const _ZodDecimal = z.preprocess((val) => { if (typeof val !== 'string') return val; try { return new ${ctor}(val); } catch { return val; } }, z.custom<Decimal>((val) => Decimal.isDecimal(val), { message: 'Must be an exact decimal sent as a quoted string, e.g. "1250.00"' }));`;
}

/** The decimal runtime for a server file that also holds Zod schemas, in emission order. */
export const DECIMAL_PRELUDE_LINES: readonly string[] = [DECIMAL_CONFIG_LINE, decimalZodSchemaLine('Decimal')];

/** The decimal runtime for an SDK file that also holds Zod schemas, in emission order. */
export const SDK_DECIMAL_PRELUDE_LINES: readonly string[] = [SDK_DECIMAL_CLONE_LINE, decimalZodSchemaLine(SDK_DECIMAL_NAME)];
