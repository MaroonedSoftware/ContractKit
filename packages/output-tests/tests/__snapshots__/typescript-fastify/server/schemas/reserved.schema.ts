import { z } from 'zod';
import { DateTime } from 'luxon';

/**
 * A seat, whose field names are all reserved somewhere in Python
 * generated from [Seat](../../contracts/reserved.ck#L13)
*/
export const Seat = z.strictObject({
    class: z.string(),
    from: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).optional(),
    date: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })),
    time: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'HH:mm:ss') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a time in format HH:mm:ss' })).optional(),
    copy: z.string().optional(),
    modelDump: z.string().optional(),
    json: z.string().optional(),
});
export type Seat = z.infer<typeof Seat>;

/**
 * Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`
 * generated from [SeatRef](../../contracts/reserved.ck#L24)
*/
export const SeatRef = z.strictObject({
    class: z.string(),
});
export type SeatRef = z.infer<typeof SeatRef>;
