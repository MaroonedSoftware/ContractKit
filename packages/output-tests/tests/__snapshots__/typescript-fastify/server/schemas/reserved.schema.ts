import { z } from 'zod';
import { DateTime } from 'luxon';

/**
 * A seat, whose field names are all reserved somewhere
 * generated from [Seat](../../contracts/reserved.ck#L23)
*/
export const Seat = z.strictObject({
    class: z.string(),
    from: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).optional(),
    in: z.string().optional(),
    is: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional(),
    object: z.string().optional(),
    default: z.string().optional(),
});
export type Seat = z.infer<typeof Seat>;

/**
 * Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`
 * generated from [SeatRef](../../contracts/reserved.ck#L33)
*/
export const SeatRef = z.strictObject({
    class: z.string(),
});
export type SeatRef = z.infer<typeof SeatRef>;
