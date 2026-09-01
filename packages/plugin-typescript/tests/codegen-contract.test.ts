import { generateContract, renderType, applyFieldModifiers } from '../src/codegen-contract.js';
import type { ContractCodegenContext } from '../src/codegen-contract.js';
import {
    scalarType,
    opParam,
    arrayType,
    tupleType,
    recordType,
    enumType,
    literalType,
    unionType,
    discriminatedUnionType,
    refType,
    lazyType,
    inlineObjectType,
    field,
    model,
    contractRoot,
} from './helpers.js';
import type { ScalarTypeNode } from '@contractkit/core';

describe('renderType', () => {
    // ─── Scalar types ───────────────────────────────────────────────

    describe('scalar types', () => {
        it('renders z.string()', () => {
            expect(renderType(scalarType('string'))).toBe('z.string()');
        });

        it('throws on an unmapped scalar name', () => {
            expect(() => renderType({ kind: 'scalar', name: 'quaternion' } as any)).toThrow(/unmapped scalar 'quaternion'/);
        });

        it('renders z.string() with min/max', () => {
            expect(renderType(scalarType('string', { min: 1, max: 100 }))).toBe('z.string().min(1).max(100)');
        });

        it('renders z.string() with min only', () => {
            expect(renderType(scalarType('string', { min: 5 }))).toBe('z.string().min(5)');
        });

        it('renders z.string() with max only', () => {
            expect(renderType(scalarType('string', { max: 50 }))).toBe('z.string().max(50)');
        });

        it('renders z.string() with length', () => {
            expect(renderType(scalarType('string', { len: 6 }))).toBe('z.string().length(6)');
        });

        it('renders z.string() with regex', () => {
            expect(renderType(scalarType('string', { regex: '[A-Z]+' }))).toBe('z.string().regex(/^[A-Z]+$/)');
        });

        it('renders z.string() with regex containing forward slashes', () => {
            expect(renderType(scalarType('string', { regex: 'https?://[^/]+/path' }))).toBe('z.string().regex(/^https?:\\/\\/[^\\/]+\\/path$/)');
        });

        it('preserves user-supplied ^ and $ anchors instead of double-wrapping', () => {
            expect(renderType(scalarType('string', { regex: '^\\+[1-9]\\d{1,14}$' }))).toBe('z.string().regex(/^\\+[1-9]\\d{1,14}$/)');
        });

        it('preserves a leading-only ^ anchor', () => {
            expect(renderType(scalarType('string', { regex: '^foo' }))).toBe('z.string().regex(/^foo/)');
        });

        it('preserves a trailing-only $ anchor', () => {
            expect(renderType(scalarType('string', { regex: 'foo$' }))).toBe('z.string().regex(/foo$/)');
        });

        it('treats an escaped trailing \\$ as a literal and still auto-anchors', () => {
            expect(renderType(scalarType('string', { regex: 'price:\\$' }))).toBe('z.string().regex(/^price:\\$$/)');
        });

        it('renders z.coerce.number()', () => {
            expect(renderType(scalarType('number'))).toBe('z.coerce.number()');
        });

        it('renders z.coerce.number() with min', () => {
            expect(renderType(scalarType('number', { min: 0 }))).toBe('z.coerce.number().min(0)');
        });

        it('renders z.coerce.number() with min and max', () => {
            expect(renderType(scalarType('number', { min: 0, max: 100 }))).toBe('z.coerce.number().min(0).max(100)');
        });

        it('renders z.coerce.number().int()', () => {
            expect(renderType(scalarType('int'))).toBe('z.coerce.number().int()');
        });

        it('renders z.coerce.number().int() with constraints', () => {
            expect(renderType(scalarType('int', { min: 1, max: 10 }))).toBe('z.coerce.number().int().min(1).max(10)');
        });

        it('renders z.bigint() with preprocess coercion from string or bigint', () => {
            expect(renderType(scalarType('bigint'))).toBe(
                `z.preprocess((val) => typeof val === 'string' ? BigInt(val.replace(/n$/, '')) : val, z.bigint())`,
            );
        });

        it('renders z.bigint() with constraints using n suffix', () => {
            const result = renderType(scalarType('bigint', { min: 0n, max: 100n }));
            expect(result).toBe(`z.preprocess((val) => typeof val === 'string' ? BigInt(val.replace(/n$/, '')) : val, z.bigint().min(0n).max(100n))`);
        });

        it('renders bare _ZodDecimal for an unconstrained decimal', () => {
            expect(renderType(scalarType('decimal'))).toBe('_ZodDecimal');
        });

        it('renders a scale refinement on decimal', () => {
            expect(renderType(scalarType('decimal', { scale: 2 }))).toBe(
                `_ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' })`,
            );
        });

        it('compares decimal bounds as exact strings, never as floats', () => {
            // `0.01` through `Number()` is the precision loss this scalar exists to prevent, so the
            // bound is emitted as a quoted string for decimal.js to parse.
            const result = renderType(scalarType('decimal', { min: '0.01', max: '999999.99' }));
            expect(result).toBe(
                `_ZodDecimal.refine((v) => v.gte('0.01') && v.lte('999999.99'), { message: 'Must be at least 0.01, at most 999999.99' })`,
            );
        });

        it('renders scale and bounds together', () => {
            const result = renderType(scalarType('decimal', { min: '0', scale: 2 }));
            expect(result).toBe(
                `_ZodDecimal.refine((v) => v.decimalPlaces() <= 2 && v.gte('0'), { message: 'Must be at most 2 decimal places, at least 0' })`,
            );
        });

        it('singularises the scale message at 1', () => {
            expect(renderType(scalarType('decimal', { scale: 1 }))).toContain(`message: 'Must be at most 1 decimal place'`);
        });

        it('renders z.boolean() with string coercion preprocess', () => {
            expect(renderType(scalarType('boolean'))).toBe(`z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean())`);
        });

        it('renders DateTime preprocess coercion for date (default format)', () => {
            const result = renderType(scalarType('date'));
            expect(result).toBe(
                `z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' }))`,
            );
        });

        it('renders DateTime preprocess coercion for date with custom format', () => {
            const result = renderType({ kind: 'scalar', name: 'date', format: 'MM/dd/yyyy' });
            expect(result).toBe(
                `z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'MM/dd/yyyy') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format MM/dd/yyyy' }))`,
            );
        });

        it('renders DateTime preprocess coercion for time (default format)', () => {
            const result = renderType(scalarType('time'));
            expect(result).toBe(
                `z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'HH:mm:ss') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a time in format HH:mm:ss' }))`,
            );
        });

        it('renders DateTime preprocess coercion for time with format', () => {
            const result = renderType({ kind: 'scalar', name: 'time', format: 'HH:mm' });
            expect(result).toBe(
                `z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'HH:mm') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a time in format HH:mm' }))`,
            );
        });

        it('renders DateTime preprocess coercion for datetime', () => {
            const result = renderType(scalarType('datetime'));
            expect(result).toBe('_ZodDatetime');
        });

        it('renders Duration preprocess coercion for duration', () => {
            expect(renderType(scalarType('duration'))).toBe(
                `z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid, { message: 'Must be an ISO 8601 duration' }))`,
            );
        });

        it('renders duration with min constraint', () => {
            expect(renderType(scalarType('duration', { min: 'PT1M' }))).toBe(
                `z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid && val.toMillis() >= Duration.fromISO('PT1M').toMillis(), { message: 'Must be an ISO 8601 duration of at least PT1M' }))`,
            );
        });

        it('renders duration with max constraint', () => {
            expect(renderType(scalarType('duration', { max: 'PT1H' }))).toBe(
                `z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid && val.toMillis() <= Duration.fromISO('PT1H').toMillis(), { message: 'Must be an ISO 8601 duration of at most PT1H' }))`,
            );
        });

        it('renders duration with min and max constraints', () => {
            expect(renderType(scalarType('duration', { min: 'PT1M', max: 'PT1H' }))).toBe(
                `z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid && val.toMillis() >= Duration.fromISO('PT1M').toMillis() && val.toMillis() <= Duration.fromISO('PT1H').toMillis(), { message: 'Must be an ISO 8601 duration between PT1M and PT1H' }))`,
            );
        });

        it('renders Interval preprocess coercion for interval', () => {
            expect(renderType(scalarType('interval'))).toBe(`_ZodInterval`);
        });

        it('renders z.email()', () => {
            expect(renderType(scalarType('email'))).toBe('z.email()');
        });

        it('renders z.url()', () => {
            expect(renderType(scalarType('url'))).toBe('z.url()');
        });

        it('renders z.uuid()', () => {
            expect(renderType(scalarType('uuid'))).toBe('z.uuid()');
        });

        it('renders z.unknown()', () => {
            expect(renderType(scalarType('unknown'))).toBe('z.unknown()');
        });

        it('renders z.null()', () => {
            expect(renderType(scalarType('null'))).toBe('z.null()');
        });

        it('renders z.record for object', () => {
            expect(renderType(scalarType('object'))).toBe('z.record(z.string(), z.unknown())');
        });

        it('renders Buffer custom validator for binary', () => {
            const result = renderType(scalarType('binary'));
            expect(result).toBe('_ZodBinary');
        });
    });

    // ─── Compound types ─────────────────────────────────────────────

    describe('compound types', () => {
        it('renders array type', () => {
            expect(renderType(arrayType(scalarType('string')))).toBe('z.array(z.string())');
        });

        it('renders array with constraints', () => {
            expect(renderType(arrayType(scalarType('string'), { min: 1, max: 10 }))).toBe('z.array(z.string()).min(1).max(10)');
        });

        it('renders tuple type', () => {
            expect(renderType(tupleType(scalarType('number'), scalarType('string')))).toBe('z.tuple([z.coerce.number(), z.string()])');
        });

        it('renders record type', () => {
            expect(renderType(recordType(scalarType('string'), scalarType('number')))).toBe('z.record(z.string(), z.coerce.number())');
        });

        it('renders enum type', () => {
            expect(renderType(enumType('a', 'b', 'c'))).toBe('z.enum(["a", "b", "c"])');
        });

        it('renders literal string', () => {
            expect(renderType(literalType('hello'))).toBe('z.literal("hello")');
        });

        it('renders literal string with quotes escaped', () => {
            expect(renderType(literalType('say "hi"'))).toBe('z.literal("say \\"hi\\"")');
        });

        it('renders literal number', () => {
            expect(renderType(literalType(42))).toBe('z.literal(42)');
        });

        it('renders literal boolean', () => {
            expect(renderType(literalType(true))).toBe('z.literal(true)');
        });

        it('renders union type', () => {
            expect(renderType(unionType(scalarType('string'), scalarType('number')))).toBe('z.union([z.string(), z.coerce.number()])');
        });

        it('renders discriminated union as z.discriminatedUnion', () => {
            const result = renderType(discriminatedUnionType('kind', refType('Card'), refType('Bank'), refType('Wire')));
            expect(result).toBe('z.discriminatedUnion("kind", [Card, Bank, Wire])');
        });

        it('renders model reference as bare name', () => {
            expect(renderType(refType('User'))).toBe('User');
        });

        it('renders lazy type', () => {
            expect(renderType(lazyType(refType('TreeNode')))).toBe('z.lazy(() => TreeNode)');
        });

        it('renders inline object type', () => {
            const result = renderType(inlineObjectType([field('key', scalarType('string')), field('value', scalarType('number'))]));
            expect(result).toContain('z.strictObject({');
            expect(result).toContain('key: z.string(),');
            expect(result).toContain('value: z.coerce.number(),');
        });
    });
});

describe('generateContract', () => {
    // ─── Simple model ──────────────────────────────────────────────

    describe('simple model', () => {
        it('generates z.strictObject with fields', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string')), field('age', scalarType('number'))])]);
            const output = generateContract(root);
            expect(output).toContain('export const User = z.strictObject({');
            expect(output).toContain('name: z.string(),');
            expect(output).toContain('age: z.coerce.number(),');
            expect(output).toContain('export type User = z.infer<typeof User>;');
        });

        it('includes zod import', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'))])]);
            const output = generateContract(root);
            expect(output).toContain("import { z } from 'zod';");
        });

        it('includes luxon import when DateTime fields exist', () => {
            const root = contractRoot([model('M', [field('d', scalarType('date'))])]);
            const output = generateContract(root);
            expect(output).toContain("import { DateTime } from 'luxon';");
        });

        it('omits luxon import when no DateTime fields', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'))])]);
            const output = generateContract(root);
            expect(output).not.toContain('luxon');
        });

        it('includes Duration import for duration fields', () => {
            const root = contractRoot([model('M', [field('d', scalarType('duration'))])]);
            const output = generateContract(root);
            expect(output).toContain("import { Duration } from 'luxon';");
            expect(output).not.toContain('DateTime');
        });

        it('includes both DateTime and Duration when both are used', () => {
            const root = contractRoot([model('M', [field('d', scalarType('datetime')), field('t', scalarType('duration'))])]);
            const output = generateContract(root);
            expect(output).toContain("import { DateTime, Duration } from 'luxon';");
        });

        it('includes Interval import for interval fields', () => {
            const root = contractRoot([model('M', [field('i', scalarType('interval'))])]);
            const output = generateContract(root);
            expect(output).toContain("import { Interval } from 'luxon';");
            expect(output).not.toContain('DateTime');
            expect(output).not.toContain('Duration');
        });

        it('includes Interval alongside DateTime and Duration when all are used', () => {
            const root = contractRoot([
                model('M', [field('d', scalarType('datetime')), field('t', scalarType('duration')), field('i', scalarType('interval'))]),
            ]);
            const output = generateContract(root);
            expect(output).toContain("import { DateTime, Duration, Interval } from 'luxon';");
        });

        it('emits _ZodInterval helper when interval field present', () => {
            const root = contractRoot([model('M', [field('i', scalarType('interval'))])]);
            const output = generateContract(root);
            expect(output).toContain(
                `const _ZodInterval = z.preprocess((val) => typeof val === 'string' ? Interval.fromISO(val) : val, z.custom<Interval>((val) => val instanceof Interval && val.isValid, { message: 'Must be an ISO 8601 interval' })).transform(val => val.toISO()!);`,
            );
        });

        it('emits the decimal.js import and _ZodDecimal helper when a decimal field is present', () => {
            const root = contractRoot([model('M', [field('amount', scalarType('decimal'))])]);
            const output = generateContract(root);
            // Named, not default: under NodeNext the default export resolves to decimal.js's
            // namespace declaration and the generated SDK fails to compile.
            expect(output).toContain(`import { Decimal } from 'decimal.js';`);
            expect(output).toContain(`Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });`);
            expect(output).toContain(`const _ZodDecimal = z.preprocess(`);
            // No output `.transform()` — `isRevalidatable` treats every scalar as idempotent under
            // re-parse, which `server.validateResponses` depends on.
            expect(output).not.toContain('_ZodDecimal = z.preprocess(...).transform');
        });

        it('omits the decimal runtime entirely when no decimal field is present', () => {
            const root = contractRoot([model('M', [field('n', scalarType('number'))])]);
            const output = generateContract(root);
            expect(output).not.toContain('decimal.js');
            expect(output).not.toContain('_ZodDecimal');
            expect(output).not.toContain('Decimal.set');
        });

        it('emits revivers only when asked, and only for decimal-carrying models', () => {
            const root = contractRoot([
                model('Money', [field('amount', scalarType('decimal'))]),
                model('Plain', [field('name', scalarType('string'))]),
            ]);
            const ctx = { modelOutPaths: new Map(), currentOutPath: '/out/t.ts' };

            // Server-side schemas get decimals already parsed by `_ZodDecimal`, so no revivers.
            const withoutRevivers = generateContract(root, ctx);
            expect(withoutRevivers).not.toContain('reviveMoney');
            expect(withoutRevivers).not.toContain('__dec');

            const withRevivers = generateContract(root, { ...ctx, modelsWithDecimal: new Set(['Money']), emitRevivers: true });
            expect(withRevivers).toContain('export function reviveMoney(raw: Money): Money {');
            expect(withRevivers).toContain(`__o0["amount"] = __dec(__o0["amount"], 'Money.amount');`);
            expect(withRevivers).not.toContain('revivePlain');
        });

        it('guards an optional or nullable decimal instead of coercing null', () => {
            const root = contractRoot([
                model('M', [
                    field('a', scalarType('decimal'), { optional: true }),
                    field('b', unionType(scalarType('decimal'), scalarType('null'))),
                ]),
            ]);
            const out = generateContract(root, {
                modelOutPaths: new Map(),
                currentOutPath: '/out/t.ts',
                modelsWithDecimal: new Set(['M']),
                emitRevivers: true,
            });
            expect(out).toContain(`if (__o0["a"] != null) {`);
            expect(out).toContain(`if (__o0["b"] != null) {`);
        });

        it('keys the Output reviver by the output casing while children stay camel', () => {
            const root = contractRoot([
                model('Money', [field('amount', scalarType('decimal'))]),
                model('Snake', [field('grossPay', scalarType('decimal')), field('childRef', refType('Money'))], { outputCase: 'snake' }),
            ]);
            const out = generateContract(root, {
                modelOutPaths: new Map(),
                currentOutPath: '/out/t.ts',
                modelsWithDecimal: new Set(['Money', 'Snake']),
                emitRevivers: true,
            });
            expect(out).toContain('export function reviveSnakeOutput(raw: SnakeOutput): SnakeOutput {');
            expect(out).toContain(`__o0["gross_pay"] = __dec(__o0["gross_pay"], 'Snake.gross_pay');`);
            // `computeModelsWithOutput` propagates referrer→referenced, so Money is NOT transformed
            // and keeps its camelCase keys — it must use the base reviver, not an Output one.
            expect(out).toContain(`reviveMoney(__o0["child_ref"] as never);`);
            expect(out).not.toContain('reviveMoneyOutput');
        });

        it('recurses through a self-referential model without looping', () => {
            const root = contractRoot([
                model('Category', [field('subtotal', scalarType('decimal')), field('children', arrayType(refType('Category')))]),
            ]);
            const out = generateContract(root, {
                modelOutPaths: new Map(),
                currentOutPath: '/out/t.ts',
                modelsWithDecimal: new Set(['Category']),
                emitRevivers: true,
            });
            expect(out).toContain('reviveCategory(__a1[__i2] as never);');
        });

        it('detects a decimal nested in an array', () => {
            const root = contractRoot([model('M', [field('amounts', arrayType(scalarType('decimal')))])]);
            expect(generateContract(root)).toContain(`import { Decimal } from 'decimal.js';`);
        });

        it('detects DateTime in nested array types', () => {
            const root = contractRoot([model('M', [field('d', arrayType(scalarType('datetime')))])]);
            const output = generateContract(root);
            expect(output).toContain("import { DateTime } from 'luxon';");
        });

        it('emits a Blob _ZodBinary by default, since the default target is the client', () => {
            const root = contractRoot([model('M', [field('f', scalarType('binary'))])]);
            const output = generateContract(root);
            expect(output).toContain('const _ZodBinary = z.custom<Blob>');
            expect(output).toContain('_ZodBinary,');
        });

        it('emits a Buffer _ZodBinary for the server target', () => {
            const root = contractRoot([model('M', [field('f', scalarType('binary'))])]);
            const output = generateContract(root, { modelOutPaths: new Map(), currentOutPath: '/out/m.ts', target: 'server' });
            // `Buffer` in an SDK type file is unresolvable: the scaffold declares no @types/node.
            expect(output).toContain('const _ZodBinary = z.custom<Buffer>');
        });

        it('omits _ZodBinary helper when no binary fields', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'))])]);
            const output = generateContract(root);
            expect(output).not.toContain('_ZodBinary');
        });

        it('emits _ZodDatetime helper when datetime field present', () => {
            const root = contractRoot([model('M', [field('f', scalarType('datetime'))])]);
            const output = generateContract(root);
            expect(output).toContain('const _ZodDatetime =');
            expect(output).toContain('_ZodDatetime,');
        });

        it('emits _ZodJson helper when json field present', () => {
            const root = contractRoot([model('M', [field('f', scalarType('json'))])]);
            const output = generateContract(root);
            expect(output).toContain('type _JsonValue =');
            expect(output).toContain('const _ZodJson:');
            expect(output).toContain('_ZodJson,');
        });

        it('omits _ZodJson helper when no json fields', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'))])]);
            const output = generateContract(root);
            expect(output).not.toContain('_ZodJson');
        });

        it('renders _ZodJson for json scalar type', () => {
            expect(renderType(scalarType('json'))).toBe('_ZodJson');
        });
    });

    // ─── Field rendering ───────────────────────────────────────────

    describe('field rendering', () => {
        it('renders nullable field with .nullable()', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { nullable: true })])]);
            const output = generateContract(root);
            expect(output).toContain('.nullable()');
        });

        it('renders optional field with .optional()', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { optional: true })])]);
            const output = generateContract(root);
            expect(output).toContain('.optional()');
        });

        it('renders default string value with .default()', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { default: 'user' })])]);
            const output = generateContract(root);
            expect(output).toContain('.default("user")');
        });

        it('renders default number value with .default()', () => {
            const root = contractRoot([model('M', [field('f', scalarType('number'), { default: 0 })])]);
            const output = generateContract(root);
            expect(output).toContain('.default(0)');
        });

        it('renders description with .describe()', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { description: 'A name' })])]);
            const output = generateContract(root);
            expect(output).toContain('.describe("A name")');
        });

        it('escapes quotes in default string values', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { default: 'he said "hello"' })])]);
            const output = generateContract(root);
            expect(output).toContain('.default("he said \\"hello\\"")');
        });

        it('escapes backslashes in default string values', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { default: 'path\\to\\file' })])]);
            const output = generateContract(root);
            expect(output).toContain('.default("path\\\\to\\\\file")');
        });

        it('escapes quotes in field descriptions', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { description: 'A "quoted" desc' })])]);
            const output = generateContract(root);
            expect(output).toContain('.describe("A \\"quoted\\" desc")');
        });

        it('escapes newlines in field descriptions', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { description: 'line1\nline2' })])]);
            const output = generateContract(root);
            expect(output).toContain('.describe("line1\\nline2")');
        });

        it('prefers .default() over .optional() when default is set', () => {
            const root = contractRoot([model('M', [field('f', scalarType('boolean'), { optional: true, default: true })])]);
            const output = generateContract(root);
            expect(output).toContain('.default(true)');
            // .optional() should not appear for this field since default is set
            const fieldLine = output.split('\n').find(l => l.includes('f:'))!;
            expect(fieldLine).not.toContain('.optional()');
        });
    });

    // ─── Three-schema pattern (visibility) ─────────────────────────

    describe('three-schema pattern', () => {
        it('generates Read and Write schemas when visibility fields exist', () => {
            const root = contractRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('name', scalarType('string')),
                    field('password', scalarType('string'), { visibility: 'writeonly' }),
                ]),
            ]);
            const output = generateContract(root);
            expect(output).toContain('export const User = z.strictObject({');
            expect(output).toContain('export const UserInput = z.strictObject({');
            expect(output).toContain('export type User = z.infer<typeof User>;');
            expect(output).toContain('export type UserInput = z.infer<typeof UserInput>;');
            // No writeonly model extends User, so nothing would read a UserBase.
            expect(output).not.toContain('const UserBase');
        });

        it('read schema omits writeonly fields', () => {
            const root = contractRoot([
                model('User', [field('name', scalarType('string')), field('password', scalarType('string'), { visibility: 'writeonly' })]),
            ]);
            const output = generateContract(root);
            // Find the exported User (read) schema section
            const userSection = output.split('export const User =')[1]!.split('});')[0]!;
            expect(userSection).toContain('name:');
            expect(userSection).not.toContain('password:');
        });

        it('write schema omits readonly fields', () => {
            const root = contractRoot([
                model('User', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('name', scalarType('string'))]),
            ]);
            const output = generateContract(root);
            // Find the UserInput (write) schema section
            const inputSection = output.split('export const UserInput =')[1]!.split('});')[0]!;
            expect(inputSection).toContain('name:');
            expect(inputSection).not.toContain('id:');
        });
    });

    // ─── Transitive Input variants ─────────────────────────────────

    describe('transitive Input variants', () => {
        it('generates Input variant for model that references a visibility model (local)', () => {
            const root = contractRoot([
                model('Entry', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('amount', scalarType('bigint'))]),
                model('Transaction', [field('entries', arrayType(refType('Entry')))]),
            ]);
            const output = generateContract(root);
            // Transaction references Entry (which has readonly → EntryInput exists)
            // so Transaction must also get an Input variant
            expect(output).toContain('export const TransactionInput = z.strictObject({');
            expect(output).toContain('export type TransactionInput = z.infer<typeof TransactionInput>;');
        });

        it('write schema of parent uses Input variant of referenced child', () => {
            const root = contractRoot([
                model('Entry', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('amount', scalarType('bigint'))]),
                model('Transaction', [field('entries', arrayType(refType('Entry')))]),
            ]);
            const output = generateContract(root);
            const inputSection = output.split('export const TransactionInput =')[1]!.split('});')[0]!;
            expect(inputSection).toContain('EntryInput');
            expect(inputSection).not.toContain('Entry,');
        });

        it('handles multi-level transitive chain', () => {
            const root = contractRoot([
                model('Leaf', [field('id', scalarType('uuid'), { visibility: 'readonly' })]),
                model('Middle', [field('leaf', refType('Leaf'))]),
                model('Top', [field('middle', refType('Middle'))]),
            ]);
            const output = generateContract(root);
            expect(output).toContain('export const MiddleInput = z.strictObject({');
            expect(output).toContain('export const TopInput = z.strictObject({');
            // TopInput should use MiddleInput; MiddleInput should use LeafInput
            const middleInputSection = output.split('export const MiddleInput =')[1]!.split('});')[0]!;
            expect(middleInputSection).toContain('LeafInput');
            const topInputSection = output.split('export const TopInput =')[1]!.split('});')[0]!;
            expect(topInputSection).toContain('MiddleInput');
        });

        it('handles transitive ref through union type', () => {
            const root = contractRoot([
                model('Child', [field('id', scalarType('uuid'), { visibility: 'readonly' })]),
                model('Parent', [field('data', unionType(refType('Child'), scalarType('null')))]),
            ]);
            const output = generateContract(root);
            expect(output).toContain('export const ParentInput = z.strictObject({');
            const inputSection = output.split('export const ParentInput =')[1]!.split('});')[0]!;
            expect(inputSection).toContain('ChildInput');
        });

        it('handles transitive ref from external context', () => {
            const root = contractRoot([model('Transaction', [field('entries', arrayType(refType('ExternalEntry')))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/transaction.ts',
                modelOutPaths: new Map([
                    ['ExternalEntry', '/out/entry.ts'],
                    ['ExternalEntryInput', '/out/entry.ts'],
                ]),
                modelsWithInput: new Set(['ExternalEntry']),
            };
            const output = generateContract(root, context);
            // Transaction should get an Input variant referencing ExternalEntryInput
            expect(output).toContain('export const TransactionInput = z.strictObject({');
            const inputSection = output.split('export const TransactionInput =')[1]!.split('});')[0]!;
            expect(inputSection).toContain('ExternalEntryInput');
            // Should import ExternalEntryInput from the correct path
            expect(output).toContain("import { ExternalEntryInput } from './entry.js';");
        });

        it('model without visibility that only refs plain models stays simple', () => {
            const root = contractRoot([
                model('PlainChild', [field('name', scalarType('string'))]),
                model('Parent', [field('child', refType('PlainChild'))]),
            ]);
            const output = generateContract(root);
            // Neither model has visibility or transitive Input deps
            expect(output).not.toContain('ParentInput');
            expect(output).not.toContain('PlainChildInput');
        });
    });

    // ─── Inheritance ───────────────────────────────────────────────

    describe('inheritance', () => {
        it('generates .extend() for models with a base', () => {
            const root = contractRoot([model('Admin', [field('role', scalarType('string'))], { bases: ['User'] })]);
            const output = generateContract(root);
            expect(output).toContain('User.extend({');
        });

        it('child extends parent in same file: both get three-schema when parent has visibility', () => {
            const root = contractRoot([
                model('User', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('name', scalarType('string'))]),
                model('Admin', [field('role', scalarType('string'))], { bases: ['User'] }),
            ]);
            const output = generateContract(root);
            // User has only readonly (no writeonly) — Base === Read, so no UserBase emitted
            expect(output).not.toContain('UserBase');
            expect(output).toContain('export const User =');
            expect(output).toContain('export const UserInput =');
            // Admin inherits from User — also gets three-schema; no writeonly so no AdminBase
            expect(output).not.toContain('AdminBase');
            expect(output).toContain('export const Admin = User.extend({');
            expect(output).toContain('export const AdminInput = UserInput.extend({');
        });

        it('child with visibility extending parent without visibility: uses .extend() for base, read, and write', () => {
            const root = contractRoot([
                model('User', [field('name', scalarType('string'))]),
                model('Admin', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('role', scalarType('string'))], {
                    bases: ['User'],
                }),
            ]);
            const output = generateContract(root);
            // User has no visibility — simple schema
            expect(output).not.toContain('UserBase');
            expect(output).not.toContain('UserInput');
            // Admin has only readonly (no writeonly) — Base === Read, so no AdminBase emitted
            expect(output).not.toContain('AdminBase');
            expect(output).toContain('export const Admin = User.extend({');
            expect(output).toContain('export const AdminInput = User.extend({');
        });

        it('inherits writeonly fields through the Input chain, with no Base schema', () => {
            const root = contractRoot([
                model('User', [field('password', scalarType('string'), { visibility: 'writeonly' }), field('name', scalarType('string'))]),
                model('Admin', [field('token', scalarType('string'), { visibility: 'writeonly' }), field('role', scalarType('string'))], {
                    bases: ['User'],
                }),
            ]);
            const output = generateContract(root);
            expect(output).not.toContain('Base');
            // AdminInput extends UserInput, which carries User's writeonly `password` — which is
            // what the Base schemas were meant to deliver and never did.
            expect(output).toContain('export const AdminInput = UserInput.extend({');
            expect(output).toContain('export const Admin = User.extend({');
        });

        it('leaves a user-declared model named XBase alone', () => {
            const root = contractRoot([
                model('User', [field('password', scalarType('string'), { visibility: 'writeonly' }), field('name', scalarType('string'))]),
                model('UserBase', [field('label', scalarType('string'))]),
            ]);
            const output = generateContract(root);
            // A text-derived rule would have had to distinguish these two; nothing generated is
            // named UserBase any more, so the user's own model is the only one.
            expect(output.match(/const UserBase\b/g)).toHaveLength(1);
            expect(output).toContain('export const UserBase = z.strictObject({');
        });

        it('child inheriting from external parent with Input variant uses ParentInput.extend()', () => {
            const root = contractRoot([
                model('Admin', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('role', scalarType('string'))], {
                    bases: ['User'],
                }),
            ]);
            const output = generateContract(root, {
                modelsWithInput: new Set(['User']),
                currentOutPath: '/out/admin.ts',
                modelOutPaths: new Map(),
            });
            expect(output).toContain('export const AdminInput = UserInput.extend({');
        });

        it('chains .extend() for multi-base inheritance', () => {
            const root = contractRoot([
                model('A', [field('a', scalarType('string'))]),
                model('B', [field('b', scalarType('int'))]),
                model('C', [field('c', scalarType('boolean'))]),
                model('D', [field('d', scalarType('string'))]),
                model('Test5', [field('e', scalarType('string'))], { bases: ['A', 'B', 'C', 'D'] }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('export const Test5 = A.extend(B.shape).extend(C.shape).extend(D.shape).extend({');
        });

        it('chains Input variants for multi-base when bases have Input variants', () => {
            const root = contractRoot([
                model('A', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('a', scalarType('string'))]),
                model('B', [field('b', scalarType('int'))]),
                model('Test', [field('e', scalarType('string'))], { bases: ['A', 'B'] }),
            ]);
            const output = generateContract(root);
            // A has Input variant (because of readonly), B doesn't.
            expect(output).toContain('export const TestInput = AInput.extend(B.shape).extend({');
        });

        it('omits override-readonly field from child Input schema', () => {
            const root = contractRoot([
                model('Base', [field('id', scalarType('uuid')), field('name', scalarType('string'))]),
                model('Child', [field('name', scalarType('string'), { visibility: 'readonly', override: true })], {
                    bases: ['Base'],
                }),
            ]);
            const output = generateContract(root);
            // Base has no visibility — no BaseInput
            expect(output).not.toContain('BaseInput');
            // Child re-declares 'name' as readonly, so 'name' must be omitted from Base before extending
            expect(output).toContain('export const ChildInput = Base.omit({ name: true }).extend({');
        });

        it('omits override-readonly field inherited transitively through multiple bases', () => {
            const root = contractRoot([
                model('Root', [field('legalId', scalarType('uuid'))]),
                model('Mid', [], { bases: ['Root'] }),
                model('Child', [field('legalId', scalarType('uuid'), { visibility: 'readonly', override: true })], {
                    bases: ['Mid'],
                }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('export const ChildInput = Mid.omit({ legalId: true }).extend({');
        });
    });

    // ─── Type alias Input variants ────────────────────────────────

    describe('type alias Input variants', () => {
        it('type alias referencing a model with Input variant gets its own Input variant', () => {
            const root = contractRoot([
                model('Pagination', [field('page', scalarType('int')), field('total', scalarType('int'), { visibility: 'readonly' })]),
                model('ListQuery', [], {
                    type: {
                        kind: 'intersection',
                        members: [
                            { kind: 'ref', name: 'Pagination' },
                            { kind: 'inlineObject', fields: [field('status', scalarType('string'), { optional: true })] },
                        ],
                    },
                }),
            ]);
            const output = generateContract(root);
            // ListQuery itself is a type alias — read schema
            expect(output).toContain('export const ListQuery = Pagination.extend({');
            // Input variant uses PaginationInput
            expect(output).toContain('export const ListQueryInput = PaginationInput.extend({');
        });

        it('imports PaginationInput when type alias references external Pagination with Input variant', () => {
            const root = contractRoot([
                model('ListQuery', [], {
                    type: {
                        kind: 'intersection',
                        members: [
                            { kind: 'ref', name: 'Pagination' },
                            { kind: 'inlineObject', fields: [field('status', scalarType('string'), { optional: true })] },
                        ],
                    },
                }),
            ]);
            const output = generateContract(root, {
                modelsWithInput: new Set(['Pagination']),
                currentOutPath: '/out/list.query.ts',
                modelOutPaths: new Map([
                    ['Pagination', '/out/pagination.ts'],
                    ['PaginationInput', '/out/pagination.ts'],
                ]),
            });
            expect(output).toContain("import { Pagination } from './pagination.js';");
            expect(output).toContain("import { PaginationInput } from './pagination.js';");
            expect(output).toContain('export const ListQueryInput = PaginationInput.extend({');
        });

        it('type alias NOT referencing any model with Input stays simple', () => {
            const root = contractRoot([model('UserId', [], { type: { kind: 'scalar', name: 'uuid' } })]);
            const output = generateContract(root);
            expect(output).toContain('export const UserId = z.uuid()');
            expect(output).not.toContain('UserIdInput');
        });

        it('ref & ref type alias uses .extend(B.shape) instead of .and()', () => {
            const root = contractRoot([
                model('Pagination', [field('page', scalarType('int'))]),
                model('Filter', [field('status', scalarType('string'), { optional: true })]),
                model('ListQuery', [], {
                    type: {
                        kind: 'intersection',
                        members: [
                            { kind: 'ref', name: 'Pagination' },
                            { kind: 'ref', name: 'Filter' },
                        ],
                    },
                }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('export const ListQuery = Pagination.extend(Filter.shape)');
            expect(output).not.toContain('.and(');
        });

        it('ref & ref type alias substitutes Input variant when base has Input', () => {
            const root = contractRoot([
                model('Pagination', [field('page', scalarType('int')), field('total', scalarType('int'), { visibility: 'readonly' })]),
                model('Filter', [field('status', scalarType('string'), { optional: true })]),
                model('ListQuery', [], {
                    type: {
                        kind: 'intersection',
                        members: [
                            { kind: 'ref', name: 'Pagination' },
                            { kind: 'ref', name: 'Filter' },
                        ],
                    },
                }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('export const ListQuery = Pagination.extend(Filter.shape)');
            expect(output).toContain('export const ListQueryInput = PaginationInput.extend(Filter.shape)');
        });
    });

    // ─── Description ──────────────────────────────────────────────

    describe('model description', () => {
        it('generates JSDoc comment for model description', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string'))], { description: 'A user' })]);
            const output = generateContract(root);
            expect(output).toContain('* A user');
        });
    });

    // ─── Source line comments ──────────────────────────────────────

    describe('source line comments', () => {
        it('includes source location comment above schema', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string'))], { loc: { file: 'user.ck', line: 5 } })]);
            const output = generateContract(root);
            expect(output).toContain('[User](./user.ck#L5)');
        });

        it('includes source location for three-schema models', () => {
            const root = contractRoot([
                model('User', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('name', scalarType('string'))], {
                    loc: { file: 'user.ck', line: 1 },
                }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('[User](./user.ck#L1)');
        });
    });

    // ─── Model reference imports ──────────────────────────────────

    describe('model reference imports', () => {
        it('imports externally referenced model types', () => {
            const root = contractRoot([model('Counterparty', [field('accounts', arrayType(refType('CounterpartyAccount')))])]);
            const output = generateContract(root);
            expect(output).toContain("import { CounterpartyAccount } from './counterparty.account.js';");
        });

        it('does not import locally defined models', () => {
            const root = contractRoot([
                model('CustomCurrency', [field('code', scalarType('string'))]),
                model('LedgerAccount', [field('currency', refType('CustomCurrency'))]),
            ]);
            const output = generateContract(root);
            expect(output).not.toContain('import { CustomCurrency }');
        });

        it('imports base model when inherited from external', () => {
            const root = contractRoot([model('Admin', [field('role', scalarType('string'))], { bases: ['User'] })]);
            const output = generateContract(root);
            expect(output).toContain("import { User } from './user.js';");
        });

        it('does not import base model when defined locally', () => {
            const root = contractRoot([
                model('User', [field('name', scalarType('string'))]),
                model('Admin', [field('role', scalarType('string'))], { bases: ['User'] }),
            ]);
            const output = generateContract(root);
            expect(output).not.toContain('import { User }');
        });

        it('emits no model imports when all refs are local', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string'))])]);
            const output = generateContract(root);
            const importLines = output.split('\n').filter(l => l.startsWith('import'));
            expect(importLines).toHaveLength(1); // only zod
        });
    });

    // ─── Cross-directory import resolution ──────────────────────────

    describe('cross-directory import resolution', () => {
        it('generates correct relative path for ref in a different directory', () => {
            const root = contractRoot([model('Counterparty', [field('accounts', arrayType(refType('CounterpartyAccount')))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/modules/transfers/counterparty.ts',
                modelOutPaths: new Map([['CounterpartyAccount', '/out/modules/transfers/counterparty.account.ts']]),
            };
            const output = generateContract(root, context);
            expect(output).toContain("import { CounterpartyAccount } from './counterparty.account.js';");
        });

        it('generates ../ path when ref is in a parent directory', () => {
            const root = contractRoot([model('Invoice', [field('pagination', refType('Pagination'))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/modules/billing/invoice.ts',
                modelOutPaths: new Map([['Pagination', '/out/shared/pagination.ts']]),
            };
            const output = generateContract(root, context);
            expect(output).toContain("import { Pagination } from '../../shared/pagination.js';");
        });

        it('generates nested ../ path for deeply separated files', () => {
            const root = contractRoot([model('Transfer', [field('account', refType('LedgerAccount'))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/modules/transfers/types/transfer.ts',
                modelOutPaths: new Map([['LedgerAccount', '/out/modules/ledger/types/ledger.account.ts']]),
            };
            const output = generateContract(root, context);
            expect(output).toContain("import { LedgerAccount } from '../../ledger/types/ledger.account.js';");
        });

        it('generates subdirectory path when ref is in a child directory', () => {
            const root = contractRoot([model('Dashboard', [field('user', refType('User'))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/dashboard.ts',
                modelOutPaths: new Map([['User', '/out/users/user.ts']]),
            };
            const output = generateContract(root, context);
            expect(output).toContain("import { User } from './users/user.js';");
        });

        it('falls back to pascalToDotCase when ref is not in modelOutPaths', () => {
            const root = contractRoot([model('Order', [field('item', refType('UnknownExternal'))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/order.ts',
                modelOutPaths: new Map(), // empty — ref not found
            };
            const output = generateContract(root, context);
            expect(output).toContain("import { UnknownExternal } from './unknown.external.js';");
        });

        it('falls back to pascalToDotCase when no context is provided', () => {
            const root = contractRoot([model('Counterparty', [field('accounts', arrayType(refType('CounterpartyAccount')))])]);
            const output = generateContract(root); // no context
            expect(output).toContain("import { CounterpartyAccount } from './counterparty.account.js';");
        });

        it('resolves multiple refs to different directories', () => {
            const root = contractRoot([model('Transfer', [field('from', refType('Counterparty')), field('pagination', refType('Pagination'))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/modules/transfers/transfer.ts',
                modelOutPaths: new Map([
                    ['Counterparty', '/out/modules/transfers/counterparty.ts'],
                    ['Pagination', '/out/shared/pagination.ts'],
                ]),
            };
            const output = generateContract(root, context);
            expect(output).toContain("import { Counterparty } from './counterparty.js';");
            expect(output).toContain("import { Pagination } from '../../shared/pagination.js';");
        });
    });

    // ─── format(input=, output=) ────────────────────────────────────
    describe('format modifier', () => {
        it('input=snake: parses snake_case keys, outputs camelCase', () => {
            const root = contractRoot([
                model('User', [field('firstName', scalarType('string')), field('lastName', scalarType('string'))], { inputCase: 'snake' }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('first_name: z.string()');
            expect(output).toContain('last_name: z.string()');
            expect(output).toContain('.transform(data => ({');
            expect(output).toContain('firstName: data.first_name');
            expect(output).toContain('lastName: data.last_name');
            expect(output).toContain('export type User = z.output<typeof User>');
        });

        it('input=camel: no transform (camel is identity)', () => {
            const root = contractRoot([
                model('User', [field('firstName', scalarType('string')), field('lastName', scalarType('string'))], { inputCase: 'camel' }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('firstName: z.string()');
            expect(output).toContain('lastName: z.string()');
            expect(output).not.toContain('.transform(');
            expect(output).toContain('export type User = z.infer<typeof User>');
        });

        it('input=pascal: parses PascalCase keys, outputs camelCase', () => {
            const root = contractRoot([
                model('User', [field('firstName', scalarType('string')), field('lastName', scalarType('string'))], { inputCase: 'pascal' }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('FirstName: z.string()');
            expect(output).toContain('LastName: z.string()');
            expect(output).toContain('.transform(data => ({');
            expect(output).toContain('firstName: data.FirstName');
            expect(output).toContain('lastName: data.LastName');
            expect(output).toContain('export type User = z.output<typeof User>');
        });

        it('output=snake: parses camelCase keys, outputs snake_case', () => {
            const root = contractRoot([
                model('User', [field('firstName', scalarType('string')), field('lastName', scalarType('string'))], { outputCase: 'snake' }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('firstName: z.string()');
            expect(output).toContain('.transform(data => ({');
            expect(output).toContain('first_name: data.firstName');
            expect(output).toContain('last_name: data.lastName');
            // Type uses z.input so the developer-facing shape stays camelCase;
            // the snake_case transform is for serialization to the wire.
            expect(output).toContain('export type User = z.input<typeof User>');
        });

        it('input=pascal, output=snake: parses PascalCase, outputs snake_case', () => {
            const root = contractRoot([
                model('User', [field('firstName', scalarType('string')), field('lastName', scalarType('string'))], {
                    inputCase: 'pascal',
                    outputCase: 'snake',
                }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('FirstName: z.string()');
            expect(output).toContain('.transform(data => ({');
            expect(output).toContain('first_name: data.FirstName');
            expect(output).toContain('last_name: data.LastName');
            expect(output).toContain('export type User = z.output<typeof User>');
        });

        it('input=pascal: nested inline objects also use PascalCase keys with transforms', () => {
            const dataType = inlineObjectType([field('id', scalarType('uuid')), field('amount', scalarType('number'))]);
            const root = contractRoot([model('Webhook', [field('event', scalarType('string')), field('data', dataType)], { inputCase: 'pascal' })]);
            const output = generateContract(root);
            expect(output).toContain('Event: z.string()');
            expect(output).toContain('Id: z.uuid()');
            expect(output).toContain('id: data.Id');
            expect(output).toContain('amount: data.Amount');
        });

        it('mode cascades to inline object fields', () => {
            const dataType = inlineObjectType([field('id', scalarType('uuid')), field('amount', scalarType('number'))]);
            const root = contractRoot([model('Webhook', [field('event', scalarType('string')), field('data', dataType)], { mode: 'loose' })]);
            const output = generateContract(root);
            expect(output).toContain('export const Webhook = z.looseObject({');
            expect(output).toContain('z.looseObject({');
            expect(output).not.toContain('z.strictObject(');
        });

        it('output=snake with modelsWithOutput emits a UserOutput alias for the wire shape', () => {
            const root = contractRoot([
                model('User', [field('firstName', scalarType('string')), field('lastName', scalarType('string'))], { outputCase: 'snake' }),
            ]);
            const output = generateContract(root, {
                modelOutPaths: new Map(),
                currentOutPath: '/tmp/user.ts',
                modelsWithOutput: new Set(['User']),
            });
            // Base type stays camelCase (developer-facing).
            expect(output).toContain('export type User = z.input<typeof User>');
            // Output alias gives the post-transform wire shape (snake_case).
            expect(output).toContain('export type UserOutput = z.output<typeof User>');
        });

        it('models without outputCase do not emit Output alias', () => {
            const root = contractRoot([model('User', [field('firstName', scalarType('string'))])]);
            const output = generateContract(root);
            expect(output).not.toContain('UserOutput');
        });

        it('child extending a format(input=snake) base inlines parent fields and inherits the transform', () => {
            // The parent compiles to z.object().transform() — a ZodPipe that has no .extend().
            // The child must flatten the chain so it can build its own object and re-apply the transform,
            // instead of emitting `Parent.extend({...})` (which fails to type-check).
            const root = contractRoot([
                model('Base', [field('grantType', scalarType('string')), field('clientId', scalarType('uuid'), { optional: true })], {
                    inputCase: 'snake',
                }),
                model(
                    'Child',
                    [
                        field('grantType', literalType('client_credentials')),
                        field('clientId', scalarType('uuid')),
                        field('clientSecret', scalarType('string')),
                    ],
                    {
                        bases: ['Base'],
                    },
                ),
            ]);
            const output = generateContract(root);
            // Child must NOT use Base.extend (Base is a ZodPipe).
            expect(output).not.toContain('Base.extend');
            // Child generates as a transformed object with snake_case input keys for both inherited and own fields.
            expect(output).toMatch(
                /export const Child = z\.strictObject\(\{[\s\S]*grant_type:[\s\S]*client_id:[\s\S]*client_secret:[\s\S]*\}\)\.transform/,
            );
            expect(output).toContain('grantType: data.grant_type');
            expect(output).toContain('clientId: data.client_id,');
            expect(output).toContain('clientSecret: data.client_secret');
            expect(output).toContain('export type Child = z.output<typeof Child>');
        });

        it('input=snake: optional fields use conditional spread guarded by `!= null`', () => {
            // .nullish() on input accepts null and undefined; conditional spread keeps the field
            // optional in the inferred output type (`k?: T`) instead of widening to required-nullable
            // (`k: T | undefined`). The `!= null` guard omits the key for both null and undefined.
            const root = contractRoot([
                model(
                    'User',
                    [field('firstName', scalarType('string')), field('clientId', scalarType('uuid'), { optional: true })],
                    { inputCase: 'snake' },
                ),
            ]);
            const output = generateContract(root);
            expect(output).toContain('client_id: z.uuid().nullish()');
            expect(output).toContain('firstName: data.first_name,');
            expect(output).toContain('...(data.client_id != null ? { clientId: data.client_id } : {}),');
            expect(output).not.toContain('?? undefined');
        });

        it('output=snake: optional fields use conditional spread guarded by `!== undefined`', () => {
            // With only outputCase set, input is `.optional()` (undefined-only). Conditional spread keeps
            // the field optional in the inferred z.input type so consumers building values with
            // `...(x ? { k: x } : {})` are assignable.
            const root = contractRoot([
                model('Token', [field('accessToken', scalarType('string')), field('refreshToken', scalarType('string'), { optional: true })], {
                    outputCase: 'snake',
                }),
            ]);
            const output = generateContract(root);
            expect(output).toContain('refreshToken: z.string().optional()');
            expect(output).toContain('access_token: data.accessToken,');
            expect(output).toContain('...(data.refreshToken !== undefined ? { refresh_token: data.refreshToken } : {}),');
            expect(output).not.toContain('?? undefined');
        });

        it('input=pascal: inline-object optional fields use conditional spread guarded by `!= null`', () => {
            const dataType = inlineObjectType([
                field('id', scalarType('uuid')),
                field('amount', scalarType('number'), { optional: true }),
            ]);
            const root = contractRoot([
                model('Webhook', [field('event', scalarType('string')), field('data', dataType)], { inputCase: 'pascal' }),
            ]);
            const output = generateContract(root);
            // Inline object emits its own transform inside the Webhook input shape.
            expect(output).toContain('Amount: z.coerce.number().nullish()');
            expect(output).toContain('id: data.Id,');
            expect(output).toContain('...(data.Amount != null ? { amount: data.Amount } : {}),');
            expect(output).not.toContain('?? undefined');
        });
    });
});

// ─── applyFieldModifiers ──────────────────────────────────────────────────

describe('applyFieldModifiers', () => {
    it('appends nothing for a plain required field', () => {
        expect(applyFieldModifiers('z.string()', {})).toBe('z.string()');
    });

    it('chains nullable, then optionality, then the description', () => {
        expect(applyFieldModifiers('z.string()', { nullable: true, optional: true, description: 'a note' })).toBe(
            'z.string().nullable().optional().describe("a note")',
        );
    });

    it('prefers a default over .optional()', () => {
        // `.default()` already makes the input side optional; adding `.optional()` on top would
        // widen the output type to include undefined, which is what a default exists to prevent.
        expect(applyFieldModifiers('z.number()', { optional: true, default: 20 })).toBe('z.number().default(20)');
    });

    it('quotes and escapes a string default', () => {
        expect(applyFieldModifiers('z.string()', { default: 'a "quoted" value' })).toBe('z.string().default("a \\"quoted\\" value")');
    });

    it('accepts an OpParamNode, which is a FieldNode without the visibility modifiers', () => {
        // This is the point of the structural parameter type: it lets a `query:` or `headers:`
        // field render through exactly the same path a model field does.
        const param = opParam('limit', scalarType('int'), { optional: true, default: 20 });
        expect(applyFieldModifiers('z.coerce.number().int()', param)).toBe('z.coerce.number().int().default(20)');
    });
});
