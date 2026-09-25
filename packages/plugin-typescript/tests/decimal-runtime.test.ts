import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { z } from 'zod';
import { computeModelsWithScalar, decomposeCk, DiagnosticCollector, parseCk } from '@contractkit/core';
import { generateContract } from '../src/codegen-contract.js';
import { generatePlainTypes } from '../src/codegen-plain-types.js';
import { DEFAULT_REVIVABLE_SCALARS } from '../src/codegen-revive.js';

/**
 * An SDK builds its decimals with a private decimal.js clone. It used to call `Decimal.set`, which
 * reconfigured the one decimal.js the consumer's own code shares with it, so importing a client
 * changed how every `Decimal` in their app printed.
 *
 * The runtime tests evaluate a generated types file against a stand-in for decimal.js rather than
 * the real package, because each test needs a fresh, unconfigured copy of the module. The stand-in is faithful in the respects under test: settings live on
 * a constructor, `set` changes them in place, `clone` makes a constructor with settings of its own,
 * `isDecimal` reads the `toStringTag`, and an instance prints by its own constructor's
 * `toExpNeg`/`toExpPos`.
 */

interface DecimalSettings {
    toExpNeg: number;
    toExpPos: number;
}

interface DecimalInstance {
    isFinite(): boolean;
    toString(): string;
    toJSON(): string;
}

interface DecimalCtor extends DecimalSettings {
    new (value: string): DecimalInstance;
    set(config: Partial<DecimalSettings>): DecimalCtor;
    clone(config?: Partial<DecimalSettings> & { defaults?: boolean }): DecimalCtor;
    isDecimal(value: unknown): boolean;
}

const DEFAULTS: DecimalSettings = { toExpNeg: -7, toExpPos: 21 };

/** A fresh copy of the decimal.js stand-in, as an app sees the package before anything imports it. */
function decimalJs(settings: DecimalSettings = DEFAULTS): DecimalCtor {
    return class Decimal {
        static toExpNeg = settings.toExpNeg;
        static toExpPos = settings.toExpPos;

        static set(config: Partial<DecimalSettings>): DecimalCtor {
            return Object.assign(this, config) as unknown as DecimalCtor;
        }

        static clone({ defaults, ...config }: Partial<DecimalSettings> & { defaults?: boolean } = {}): DecimalCtor {
            const from = defaults ? DEFAULTS : { toExpNeg: this.toExpNeg, toExpPos: this.toExpPos };
            return decimalJs({ ...from, ...config });
        }

        static isDecimal(value: unknown): boolean {
            return (value as { toStringTag?: unknown } | null)?.toStringTag === '[object Decimal]';
        }

        readonly toStringTag = '[object Decimal]';

        constructor(private readonly value: string) {
            if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`[DecimalError] Invalid argument: ${value}`);
        }

        /** The constructor only admits plain digit strings, so every instance is finite. */
        isFinite(): boolean {
            return true;
        }

        toString(): string {
            const { toExpNeg, toExpPos } = this.constructor as DecimalCtor;
            const sign = this.value.startsWith('-') ? '-' : '';
            const [int = '', frac = ''] = this.value.replace('-', '').split('.');
            const digits = int + frac;
            const first = digits.search(/[1-9]/);
            const exponent = int.length - 1 - first;
            if (first < 0 || (exponent > toExpNeg && exponent < toExpPos)) return this.value;
            const significant = digits.slice(first).replace(/0+$/, '');
            const mantissa = significant.length > 1 ? `${significant[0]}.${significant.slice(1)}` : significant;
            return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${Math.abs(exponent)}`;
        }

        toJSON(): string {
            return this.toString();
        }
    };
}

const MONEY = `
contract Money: {
    amount: decimal
}
`;

/** The types file for `Money`, as the SDK (`emitRevivers`) or the server renders it. */
function typesFile(flavor: 'plain' | 'zod', side: 'sdk' | 'server' = 'sdk'): string {
    const diag = new DiagnosticCollector();
    const { contract } = decomposeCk(parseCk(MONEY, 'money.ck', diag));
    expect(diag.getAll().filter(d => d.severity === 'error')).toEqual([]);
    const context = {
        modelOutPaths: new Map<string, string>(),
        currentOutPath: '/out/money.types.ts',
        ...(side === 'sdk' ? { modelsWithDecimal: computeModelsWithScalar(contract.models, DEFAULT_REVIVABLE_SCALARS), emitRevivers: true } : {}),
    };
    return flavor === 'zod' ? generateContract(contract, context) : generatePlainTypes(contract, context);
}

/** Evaluate a generated file with `Decimal` bound to `decimal`, and zod for real. */
function load(source: string, decimal: DecimalCtor): Record<string, (value: unknown) => unknown> & { Money?: z.ZodType } {
    const body = source
        .split('\n')
        .filter(l => !l.startsWith('import '))
        .join('\n');
    const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('exports', 'Decimal', 'z', js)(exports, decimal, z);
    return exports as ReturnType<typeof load>;
}

describe.each(['plain', 'zod'] as const)('an SDK types file in %s mode', flavor => {
    it('never calls Decimal.set', () => {
        expect(typesFile(flavor)).not.toContain('Decimal.set(');
    });

    it('leaves the decimal.js it shares with the app exactly as the app configured it', () => {
        const Decimal = decimalJs();
        Decimal.set({ toExpNeg: -3 });
        load(typesFile(flavor), Decimal);
        expect(Decimal.toExpNeg).toBe(-3);
        expect(Decimal.toExpPos).toBe(21);
        expect(String(new Decimal('0.0001'))).toBe('1e-4');
    });

    it('revives a decimal that still prints in plain digits', () => {
        const Decimal = decimalJs();
        const { reviveMoney } = load(typesFile(flavor), Decimal);
        const money = reviveMoney!({ amount: '0.00000001' }) as { amount: unknown };
        expect(Decimal.isDecimal(money.amount)).toBe(true);
        expect(JSON.stringify(money)).toBe('{"amount":"0.00000001"}');
        // The app's own decimal, built from the same copy of decimal.js, keeps the defaults.
        expect(String(new Decimal('0.00000001'))).toBe('1e-8');
    });
});

describe('an SDK zod schema', () => {
    it('parses a decimal through the same private clone', () => {
        const Decimal = decimalJs();
        const { Money } = load(typesFile('zod'), Decimal);
        expect(JSON.stringify(Money!.parse({ amount: '0.00000001' }))).toBe('{"amount":"0.00000001"}');
        expect(Decimal.toExpNeg).toBe(-7);
    });

    it('accepts a decimal the app built with its own constructor', () => {
        const Decimal = decimalJs();
        const { Money } = load(typesFile('zod'), Decimal);
        expect(Money!.safeParse({ amount: new Decimal('1250.00') }).success).toBe(true);
    });
});

describe.each(['plain', 'zod'] as const)('a server types file in %s mode', flavor => {
    // The server is the app, and the global config is what keeps `JSON.stringify` over a handler's
    // own `Decimal` values out of exponential notation.
    it('still sets the global decimal.js config', () => {
        const Decimal = decimalJs();
        load(typesFile(flavor, 'server'), Decimal);
        expect(Decimal.toExpNeg).toBe(-9e15);
        expect(String(new Decimal('0.00000001'))).toBe('0.00000001');
    });
});
