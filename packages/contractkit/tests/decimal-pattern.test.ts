import { describe, it, expect } from 'vitest';
import { DECIMAL_PATTERN, decimalPattern } from '../src/decimal-pattern.js';

/** Inputs the decimal runtimes disagreed on before the grammar was pinned, plus plain controls. */
const REJECTED = ['1e5', '1E5', '0x1F', '0b101', '.5', '5.', '+5', '1_000', 'NaN', 'Infinity', '-Infinity', ' 5', '5 ', '', '-', '1.2.3', '١٢'];
const ACCEPTED = ['0', '-0', '5', '-5', '1250.50', '1250.00', '0.00000001', '1.10', '1.234', '007'];

/**
 * The reference meaning of `scale`: the plain grammar, with at most `scale` fraction digits once
 * trailing zeros are dropped. The patterns must agree with this on every input.
 */
function reference(input: string, scale?: number): boolean {
    if (!/^-?[0-9]+(\.[0-9]+)?$/.test(input)) return false;
    if (scale === undefined) return true;
    const fraction = (input.split('.')[1] ?? '').replace(/0+$/, '');
    return fraction.length <= scale;
}

describe('DECIMAL_PATTERN', () => {
    const re = new RegExp(DECIMAL_PATTERN);

    it.each(ACCEPTED)('accepts %j', input => {
        expect(re.test(input)).toBe(true);
    });

    it.each(REJECTED)('rejects %j', input => {
        expect(re.test(input)).toBe(false);
    });

    it('is what decimalPattern returns with no scale', () => {
        expect(decimalPattern()).toBe(DECIMAL_PATTERN);
    });
});

describe('decimalPattern(scale)', () => {
    it('allows trailing zeros past the scale, since scale counts normalized places', () => {
        const re = new RegExp(decimalPattern(1));
        expect(re.test('1.10')).toBe(true);
        expect(re.test('1.1000')).toBe(true);
        expect(re.test('1.01')).toBe(false);
    });

    it('builds a valid pattern for scale=0 that allows only an all-zero fraction', () => {
        const re = new RegExp(decimalPattern(0));
        expect(re.test('5')).toBe(true);
        expect(re.test('5.00')).toBe(true);
        expect(re.test('5.5')).toBe(false);
        expect(re.test('5.')).toBe(false);
    });

    const extra = ['1.5', '1.25', '1.250', '1.2500', '1.255', '-3.100', '10.000001', '10.0000010'];
    for (const scale of [undefined, 0, 1, 2, 3]) {
        it(`agrees with the normalized-places reference at scale=${scale}`, () => {
            const re = new RegExp(decimalPattern(scale));
            for (const input of [...ACCEPTED, ...REJECTED, ...extra]) {
                expect(re.test(input), input).toBe(reference(input, scale));
            }
        });
    }
});
