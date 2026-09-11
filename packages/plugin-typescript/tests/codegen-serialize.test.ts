import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { computeModelsWithInput, computeModelsWithOutput, decomposeCk, DiagnosticCollector, parseCk } from '@contractkit/core';
import type { ContractRootNode, OpRootNode } from '@contractkit/core';
import { computeModelsWithSerializer } from '../src/codegen-serialize.js';
import { computeModelsWithWireInput } from '../src/codegen-wire-input.js';
import { generateContract } from '../src/codegen-contract.js';
import { generatePlainTypes } from '../src/codegen-plain-types.js';
import { createTypescriptPlugin } from '../src/index.js';

/**
 * Request bodies in the text the router parses: a `date` or `time` in its contract format rather
 * than `DateTime.toJSON()`'s full timestamp, and a `decimal` in normal notation.
 *
 * The runtime tests evaluate the generated serializers against stand-ins for luxon and decimal.js,
 * which this package does not install. Each stand-in carries the property its library's own class
 * test reads (`isLuxonDateTime`, and `toStringTag` on the prototype), and nothing else the
 * serializer could lean on by accident.
 */

function parse(source: string, file = 'test.ck'): { contract: ContractRootNode; op: OpRootNode } {
    const diag = new DiagnosticCollector();
    const parsed = decomposeCk(parseCk(source, file, diag));
    expect(diag.getAll().filter(d => d.severity === 'error')).toEqual([]);
    return parsed;
}

function serializerSet(source: string): string[] {
    return [...computeModelsWithSerializer(parse(source).contract.models)].sort();
}

/** The SDK types file for `source`, rendered as the plugin renders it for `flavor`. */
function sdkTypes(source: string, flavor: 'zod' | 'plain' = 'plain'): string {
    const { contract } = parse(source);
    const models = contract.models;
    const modelMap = new Map(models.map(m => [m.name, m]));
    const context = {
        modelOutPaths: new Map<string, string>(),
        currentOutPath: '/out/test.types.ts',
        modelsWithInput: computeModelsWithInput(models),
        modelsWithWireInput: computeModelsWithWireInput(models, flavor),
        modelsWithSerializer: computeModelsWithSerializer(models, modelMap),
        modelMap,
    };
    return flavor === 'zod' ? generateContract(contract, context) : generatePlainTypes(contract, context);
}

/** One emitted `serializeX` declaration. */
function serializerDecl(out: string, name: string): string {
    const start = out.indexOf(`export function serialize${name}(`);
    expect(start, `no serialize${name} in:\n${out}`).toBeGreaterThanOrEqual(0);
    return out.slice(start, out.indexOf('\n}', start) + 2);
}

/** Every function a plain SDK types file for `source` exports, evaluated. */
function serializers(source: string): Record<string, (value: unknown) => unknown> {
    const body = sdkTypes(source)
        .split('\n')
        .filter(l => !l.startsWith('import ') && !l.startsWith('Decimal.set('))
        .join('\n');
    const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, (value: unknown) => unknown> = {};
    new Function('exports', js)(exports);
    return exports;
}

/** A luxon `DateTime` as far as the serializer can tell: `toJSON` is what the bug sent. */
function dateTime(iso: string) {
    return {
        isLuxonDateTime: true,
        toFormat: (fmt: string) => `${iso}@${fmt}`,
        toJSON: () => `${iso}T00:00:00.000-04:00`,
    };
}

const DECIMAL_PROTO = { toStringTag: '[object Decimal]' };
/** A decimal.js `Decimal` as far as the serializer can tell. The tag lives on the prototype, as it does in decimal.js. */
function decimal(normal: string, exponential: string) {
    return Object.assign(Object.create(DECIMAL_PROTO), { toFixed: () => normal, toJSON: () => exponential });
}

describe('computeModelsWithSerializer', () => {
    it('takes a model with a date, time or decimal field, and every model that reaches one', () => {
        const source = `
contract Day: { on: date }
contract Clock: { at: time }
contract Money: { amount: decimal }
contract HoldsDay: { day: Day }
contract ListsMoney: { items: array(Money) }
contract ExtendsClock: Clock & { label: string }
contract Deep: { inner: HoldsDay }
contract Plain: { name: string }
`;
        expect(serializerSet(source)).toEqual(['Clock', 'Day', 'Deep', 'ExtendsClock', 'HoldsDay', 'ListsMoney', 'Money']);
    });

    it('leaves out datetime, duration and bigint, which already go out in the form the router reads', () => {
        expect(serializerSet('contract Event: { at: datetime, ttl: duration, seq: bigint }')).toEqual([]);
    });

    it('leaves out a model whose only date is readonly, which a request never sends', () => {
        expect(serializerSet('contract Audit: { createdOn: readonly date, note: string }')).toEqual([]);
    });

    it('leaves out a model whose only date sits in a union no value can be told apart in', () => {
        // A DateTime could be the `date` or the `time`; there is no single format to write it in.
        expect(serializerSet('contract Either: { when: date | time }')).toEqual([]);
    });
});

describe('serializeX: runtime behaviour', () => {
    it('writes a date and a time in their contract formats and a decimal in normal notation', () => {
        const { serializeSlot } = serializers(`
contract Slot: {
    day: date
    opens: time
    closes: time("HH:mm")
    legacy: date("dd.MM.yyyy")
    fee: decimal
    stamp: datetime
    note: string
}
`);
        const stamp = dateTime('2026-09-11T10:00');
        const out = serializeSlot!({
            day: dateTime('2026-09-11'),
            opens: dateTime('09:00'),
            closes: dateTime('17:00'),
            legacy: dateTime('2026-09-12'),
            fee: decimal('0.00000001', '1e-8'),
            stamp,
            note: 'n',
        });
        expect(out).toEqual({
            day: '2026-09-11@yyyy-MM-dd',
            opens: '09:00@HH:mm:ss',
            closes: '17:00@HH:mm',
            legacy: '2026-09-12@dd.MM.yyyy',
            fee: '0.00000001',
            // A datetime's `toJSON` is already the ISO form the router's `fromISO` reads.
            stamp,
            note: 'n',
        });
    });

    it('returns a copy and leaves the caller’s object, and every nested one, as it was', () => {
        const { serializeOrder } = serializers(`
contract Line: { amount: decimal }
contract Order: { day: date, lines: array(Line), meta: { shippedOn: date } }
`);
        const day = dateTime('2026-09-11');
        const line = { amount: decimal('1.5', '1.5') };
        const meta = { shippedOn: dateTime('2026-09-12') };
        const order = { day, lines: [line], meta };
        const out = serializeOrder!(order) as Record<string, unknown>;
        expect(out).not.toBe(order);
        expect(order.day).toBe(day);
        expect(order.lines[0]).toBe(line);
        expect(line.amount).not.toBe('1.5');
        expect(order.meta).toBe(meta);
        expect(meta.shippedOn).not.toBe('2026-09-12@yyyy-MM-dd');
        expect(out).toEqual({ day: '2026-09-11@yyyy-MM-dd', lines: [{ amount: '1.5' }], meta: { shippedOn: '2026-09-12@yyyy-MM-dd' } });
    });

    it('keeps an absent optional field absent and a null one null', () => {
        // `URLSearchParams` would write an `undefined` it was handed as the text "undefined".
        const { serializeWindow } = serializers('contract Window: { from?: date, to: date | null, until: date = "2026-12-31" }');
        expect(serializeWindow!({ to: null })).toStrictEqual({ to: null });
    });

    it('passes through a value that is already text, as a plain-JavaScript caller may send', () => {
        const { serializeSlot } = serializers('contract Slot: { day: date, fee: decimal }');
        expect(serializeSlot!({ day: '2026-09-11', fee: '10.50' })).toEqual({ day: '2026-09-11', fee: '10.50' });
    });

    it('walks arrays, records, tuples and nested models', () => {
        const { serializeBook } = serializers(`
contract Line: { on: date }
contract Book: {
    lines: array(Line)
    byName: record(string, date)
    span: tuple(date, string)
    grid: array(array(decimal))
}
`);
        expect(
            serializeBook!({
                lines: [{ on: dateTime('a') }, { on: dateTime('b') }],
                byName: { x: dateTime('c') },
                span: [dateTime('d'), 'label'],
                grid: [[decimal('1', '1e0')]],
            }),
        ).toEqual({
            lines: [{ on: 'a@yyyy-MM-dd' }, { on: 'b@yyyy-MM-dd' }],
            byName: { x: 'c@yyyy-MM-dd' },
            span: ['d@yyyy-MM-dd', 'label'],
            grid: [['1']],
        });
    });

    it('reads the keys format(input=) renames, on the model and on an inline object below it', () => {
        const source = `
contract format(input=snake) Shipment: {
    dueOn: date
    details: { shippedOn: date }
}
`;
        const { serializeShipment } = serializers(source);
        expect(serializeShipment!({ due_on: dateTime('a'), details: { shipped_on: dateTime('b') } })).toEqual({
            due_on: 'a@yyyy-MM-dd',
            details: { shipped_on: 'b@yyyy-MM-dd' },
        });
        // Its parameter is the `WireInput` type the SDK method takes the body as.
        expect(serializerDecl(sdkTypes(source), 'Shipment')).toContain('export function serializeShipment(value: ShipmentWireInput): unknown {');
    });

    it('writes an inherited field, in the format of an override that redeclares it', () => {
        const { serializeChild } = serializers(`
contract Parent: { openedOn: date, closedOn: date }
contract Child: Parent & { closedOn: override date("dd.MM.yyyy"), label: string }
`);
        expect(serializeChild!({ openedOn: dateTime('a'), closedOn: dateTime('b'), label: 'l' })).toEqual({
            openedOn: 'a@yyyy-MM-dd',
            closedOn: 'b@dd.MM.yyyy',
            label: 'l',
        });
    });

    it('picks a discriminated-union member by its tag', () => {
        const { serializeEnvelope } = serializers(`
contract Envelope: {
    event: discriminated(by=kind, { kind: literal("day"), on: date } | { kind: literal("slot"), on: time })
}
`);
        expect(serializeEnvelope!({ event: { kind: 'day', on: dateTime('a') } })).toEqual({ event: { kind: 'day', on: 'a@yyyy-MM-dd' } });
        expect(serializeEnvelope!({ event: { kind: 'slot', on: dateTime('b') } })).toEqual({ event: { kind: 'slot', on: 'b@HH:mm:ss' } });
    });

    it('rewrites a union member only when a value can be told to be that member', () => {
        const { serializeNote } = serializers(`
contract Line: { on: date }
contract Note: {
    when: date | string
    line: Line | string
}
`);
        expect(serializeNote!({ when: dateTime('a'), line: { on: dateTime('b') } })).toEqual({ when: 'a@yyyy-MM-dd', line: { on: 'b@yyyy-MM-dd' } });
        expect(serializeNote!({ when: 'soon', line: 'none' })).toEqual({ when: 'soon', line: 'none' });
    });

    it('rewrites a type alias as a whole', () => {
        const { serializeDay } = serializers('contract Day: date');
        expect(serializeDay!(dateTime('a'))).toBe('a@yyyy-MM-dd');
    });
});

describe('serializeX: emitted declarations', () => {
    const SOURCE = `
contract Line: { amount: decimal, on: date }
contract Order: { day: date, lines: array(Line) }
`;

    it.each(['zod', 'plain'] as const)('declares a serializer beside each model in %s mode, with only the helpers it calls', flavor => {
        const out = sdkTypes(SOURCE, flavor);
        expect(serializerDecl(out, 'Order')).toContain('__a1[__i2] = serializeLine(__a1[__i2] as never);');
        expect(out).toContain('const __wireDt = ');
        expect(out).toContain('const __wireDec = ');
        expect(sdkTypes('contract Slot: { day: date }', flavor)).not.toContain('const __wireDec = ');
    });

    it('emits nothing for a server types file, which parses requests rather than sending them', () => {
        const out = generateContract(parse(SOURCE).contract);
        expect(out).not.toContain('serialize');
        expect(out).not.toContain('__wire');
    });

    it('formats with exactly the format strings the router parses the body with', () => {
        const source = `
contract Booking: {
    day: date("MM/dd/yyyy")
    at: time
    back: date
}
`;
        const formats = (text: string, re: RegExp) => [...text.matchAll(re)].map(m => m[1]).sort();
        const parsed = formats(generateContract(parse(source).contract), /DateTime\.fromFormat\(val, '([^']+)'\)/g);
        expect(parsed).toEqual(['HH:mm:ss', 'MM/dd/yyyy', 'yyyy-MM-dd']);
        expect(formats(serializerDecl(sdkTypes(source), 'Booking'), /__wireDt\([^,]+, '([^']+)'\)/g)).toEqual(parsed);
    });
});

describe('createTypescriptPlugin (sdk): request bodies', () => {
    const BASE = `
contract Period: {
    from: date
}
contract Audited: {
    openedOn: date
    period: Period
}
`;
    const TYPES = `
contract Line: {
    amount: decimal
}
contract Invoice: Audited & {
    note: string
}
`;
    const OPS = `
operation /invoices: {
    post: {
        sdk: createInvoice
        service: InvoiceService.create
        request: {
            application/json: Invoice
        }
        response: {
            204:
        }
    }
    put: {
        sdk: replaceLines
        service: InvoiceService.replaceLines
        request: {
            application/json: array(Line)
        }
        response: {
            204:
        }
    }
}
`;

    async function run(zod: boolean): Promise<Map<string, string>> {
        const base = parse(BASE, '/project/contracts/base.ck').contract;
        const types = parse(TYPES, '/project/contracts/types.ck').contract;
        const op = parse(OPS, '/project/contracts/invoices.ck').op;
        const models = [...base.models, ...types.models];
        const plugin = createTypescriptPlugin(
            { sdk: { zod, output: { sdk: 'sdk/sdk.ts', types: 'sdk/types/{filename}.ts', clients: 'sdk/clients/{filename}.client.ts' } } },
            '/project',
        );
        const emitted = new Map<string, string>();
        await plugin.generateTargets!(
            {
                contractRoots: [base, types],
                opRoots: [op],
                modelOutPaths: new Map(),
                modelsWithInput: computeModelsWithInput(models),
                modelsWithOutput: computeModelsWithOutput(models),
            },
            {
                rootDir: '/project',
                options: {},
                cacheEnabled: false,
                cacheDir: '/project/.contractkit/cache',
                emitFile: (path: string, content: string) => emitted.set(path, content),
                warn: () => {},
            },
        );
        return emitted;
    }

    it.each([false, true])('passes a body through its model serializer, imported from the types file (zod: %s)', async zod => {
        const emitted = await run(zod);
        const client = emitted.get('/project/sdk/clients/invoices.client.ts')!;
        expect(client).toContain('body: JSON.stringify(serializeInvoice(body), bigIntReplacer),');
        expect(client).toContain('body: JSON.stringify(body.map(serializeLine), bigIntReplacer),');
        expect(client).toContain("import { serializeInvoice, serializeLine } from '../types/types.js';");
    });

    it.each([false, true])(
        'writes an inherited field from a base in another file, importing its serializer only where called (zod: %s)',
        async zod => {
            const emitted = await run(zod);
            const types = emitted.get('/project/sdk/types/types.ts')!;
            const invoice = serializerDecl(types, 'Invoice');
            expect(invoice).toContain(`__o0["openedOn"] = __wireDt(__o0["openedOn"], 'yyyy-MM-dd');`);
            expect(invoice).toContain(`__o0["period"] = serializePeriod(__o0["period"] as never);`);
            // Only the base's file mentions Period, so nothing else in this file imports from there for it.
            expect(types).toContain("import { serializePeriod } from './base.js';");
            // The base's own serializer is not called, so it is not imported; the helper is local.
            expect(types).not.toContain('serializeAudited');
            expect(types).toContain('const __wireDt = ');
        },
    );
});
