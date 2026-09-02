import { z } from 'zod';
import { Decimal } from 'decimal.js';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const _ZodDecimal = z.preprocess((val) => { if (typeof val !== 'string') return val; try { return new Decimal(val); } catch { return val; } }, z.custom<Decimal>((val) => Decimal.isDecimal(val), { message: 'Must be an exact decimal sent as a quoted string, e.g. "1250.00"' }));

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
