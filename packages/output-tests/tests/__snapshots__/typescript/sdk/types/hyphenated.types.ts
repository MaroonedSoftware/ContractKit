import { z } from 'zod';
import { Decimal } from 'decimal.js';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const _ZodDecimal = z.preprocess((val) => { if (typeof val !== 'string') return val; try { return new Decimal(val); } catch { return val; } }, z.custom<Decimal>((val) => Decimal.isDecimal(val), { message: 'Must be an exact decimal sent as a quoted string, e.g. "1250.00"' }));

const __dec = (v: unknown, path: string): Decimal => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected a decimal string at '${path}', received ${typeof v} — decimals must be sent as quoted JSON strings.`);
    }
    try {
        return new Decimal(v);
    } catch {
        throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid decimal.`);
    }
};
/** A decimal.js value in normal notation, which its `toString()` is not at every magnitude. Anything else is returned as it is. */
const __wireDec = (v: unknown): unknown =>
    (v as { toStringTag?: unknown } | null | undefined)?.toStringTag === '[object Decimal]' ? (v as { toFixed(): string }).toFixed() : v;

/**
 * generated from [Invoice](../../contracts/hyphenated.ck#L12)
*/
export const Invoice = z.strictObject({
    id: z.uuid(),
    total: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' }),
});
export type Invoice = z.infer<typeof Invoice>;

export const InvoiceInput = z.strictObject({
    total: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' }),
});
export type InvoiceInput = z.infer<typeof InvoiceInput>;

/** Rehydrates every wire-encoded scalar in a Invoice into its runtime type. Mutates and returns `raw`. */
export function reviveInvoice(raw: Invoice): Invoice {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["total"] = __dec(__o0["total"], 'Invoice.total');
    return raw;
}

/** Invoice as a request body sends it, with every `date`, `time` and `decimal` in the text the server parses. Returns a copy; `value` is not modified. */
export function serializeInvoice(value: InvoiceInput): unknown {
    const __o0 = { ...value } as Record<string, unknown>;
    __o0["total"] = __wireDec(__o0["total"]);
    return __o0;
}
