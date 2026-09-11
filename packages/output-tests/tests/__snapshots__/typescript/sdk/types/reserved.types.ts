import { z } from 'zod';
import { DateTime } from 'luxon';

const __dtf = (v: unknown, path: string, fmt: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected a string at '${path}' in format ${fmt}, received ${typeof v}.`);
    }
    const d = DateTime.fromFormat(v, fmt);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' does not match format ${fmt}.`);
    return d;
};

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

/** Rehydrates every wire-encoded scalar in a Seat into its runtime type. Mutates and returns `raw`. */
export function reviveSeat(raw: Seat): Seat {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0["from"] != null) {
        __o0["from"] = __dtf(__o0["from"], 'Seat.from', 'yyyy-MM-dd');
    }
    __o0["date"] = __dtf(__o0["date"], 'Seat.date', 'yyyy-MM-dd');
    if (__o0["time"] != null) {
        __o0["time"] = __dtf(__o0["time"], 'Seat.time', 'HH:mm:ss');
    }
    return raw;
}

/**
 * Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`
 * generated from [SeatRef](../../contracts/reserved.ck#L24)
*/
export const SeatRef = z.strictObject({
    class: z.string(),
});
export type SeatRef = z.infer<typeof SeatRef>;
