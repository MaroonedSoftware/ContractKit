import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { computeModelsWithScalar, DECIMAL_PATTERN, decimalPattern, decomposeCk, DiagnosticCollector, parseCk } from '@contractkit/core';
import { generateContract } from '../src/codegen-contract.js';
import { generatePlainTypes } from '../src/codegen-plain-types.js';
import { DEFAULT_REVIVABLE_SCALARS } from '../src/codegen-revive.js';

/**
 * One wire type, three generated descriptions of it: the OpenAPI `pattern` plugin-docs publishes
 * (built by core's `decimalPattern`, with bounds in `x-contractkit-min`), the Zod schema the server
 * and a zod-mode SDK validate with, and the SDK's `__dec` reviver. They used to disagree in both
 * directions: the server took `"1e5"` and `"NaN"` that the spec forbids, and the spec rejected
 * `"1.10"` at `scale=1` that the server took. This runs every input against all three, with the
 * real decimal.js, and requires them to agree.
 */

const SOURCE = `
contract Amounts: {
    bare: decimal
    scaled: decimal(scale=2)
    floor: decimal(min=0)
}
`;

/** The declared constraints of each field, as the OpenAPI schema carries them. */
const FIELDS = {
    bare: {},
    scaled: { scale: 2 },
    floor: { min: '0' },
} as const satisfies Record<string, { scale?: number; min?: string }>;

type Field = keyof typeof FIELDS;

const INPUTS = [
    '1250.50',
    '1250.00',
    '0',
    '-5',
    '1.10',
    '1.234',
    '0.00000001',
    '1e5',
    '0x1F',
    '0b101',
    '.5',
    '5.',
    '+5',
    '1_000',
    'NaN',
    'Infinity',
    '-Infinity',
    ' 5',
    '',
];

/** What the published OpenAPI schema says about `input`: the pattern, then the exact bound. */
function openApiAccepts(field: Field, input: string): boolean {
    const spec: { scale?: number; min?: string } = FIELDS[field];
    if (!new RegExp(decimalPattern(spec.scale)).test(input)) return false;
    return spec.min === undefined || new Decimal(input).gte(spec.min);
}

function typesFile(flavor: 'plain' | 'zod', side: 'sdk' | 'server'): string {
    const diag = new DiagnosticCollector();
    const { contract } = decomposeCk(parseCk(SOURCE, 'amounts.ck', diag));
    expect(diag.getAll().filter(d => d.severity === 'error')).toEqual([]);
    const context = {
        modelOutPaths: new Map<string, string>(),
        currentOutPath: '/out/amounts.types.ts',
        ...(side === 'sdk' ? { modelsWithDecimal: computeModelsWithScalar(contract.models, DEFAULT_REVIVABLE_SCALARS), emitRevivers: true } : {}),
    };
    return flavor === 'zod' ? generateContract(contract, context) : generatePlainTypes(contract, context);
}

interface Loaded {
    Amounts?: z.ZodObject<Record<Field, z.ZodType>>;
    reviveAmounts?: (value: unknown) => unknown;
}

/**
 * Evaluate a generated file against a fresh copy of the real decimal.js, so the server file's
 * `Decimal.set` cannot leak into another test.
 */
function load(source: string): Loaded {
    const body = source
        .split('\n')
        .filter(l => !l.startsWith('import '))
        .join('\n');
    const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('exports', 'Decimal', 'z', js)(exports, Decimal.clone({ defaults: true }), z);
    return exports as Loaded;
}

const SCHEMAS = {
    server: load(typesFile('zod', 'server')).Amounts!,
    sdk: load(typesFile('zod', 'sdk')).Amounts!,
};
const { reviveAmounts } = load(typesFile('plain', 'sdk'));

function revives(input: string): boolean {
    try {
        reviveAmounts!({ bare: input, scaled: '1', floor: '1' });
        return true;
    } catch {
        return false;
    }
}

describe.each(['server', 'sdk'] as const)('the %s Zod schema agrees with the OpenAPI schema', side => {
    describe.each(Object.keys(FIELDS) as Field[])('for %s', field => {
        it.each(INPUTS)('on %j', input => {
            expect(SCHEMAS[side].shape[field].safeParse(input).success).toBe(openApiAccepts(field, input));
        });
    });
});

describe('the SDK reviver agrees with the OpenAPI wire grammar', () => {
    // A reviver checks the grammar only: the SDK does not re-validate a response's bounds or scale.
    it.each(INPUTS)('on %j', input => {
        expect(revives(input)).toBe(new RegExp(DECIMAL_PATTERN).test(input));
    });

    it('rejects a JSON number', () => {
        expect(() => reviveAmounts!({ bare: 5, scaled: '1', floor: '1' })).toThrow(TypeError);
    });
});

describe('output normalization is unchanged', () => {
    it.each(['server', 'sdk'] as const)('%s: prints a tiny value in plain digits and drops trailing zeros', side => {
        const parsed = SCHEMAS[side].parse({ bare: '0.00000001', scaled: '1250.00', floor: '0' });
        expect(JSON.stringify(parsed)).toBe('{"bare":"0.00000001","scaled":"1250","floor":"0"}');
    });

    it('SDK reviver: the same', () => {
        expect(JSON.stringify(reviveAmounts!({ bare: '0.00000001', scaled: '1250.00', floor: '0' }))).toBe('{"bare":"0.00000001","scaled":"1250","floor":"0"}');
    });

    it('still accepts a Decimal that is already built, so a re-parse is stable', () => {
        const once = SCHEMAS.server.parse({ bare: '1.5', scaled: '1.5', floor: '1.5' });
        expect(SCHEMAS.server.safeParse(once).success).toBe(true);
    });

    it('rejects a non-finite Decimal that is already built', () => {
        expect(SCHEMAS.server.shape.bare.safeParse(new Decimal('NaN')).success).toBe(false);
    });
});
