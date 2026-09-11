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
/** A luxon DateTime in `fmt`, as the server's `DateTime.fromFormat` reads it. Anything else is returned as it is. */
const __wireDt = (v: unknown, fmt: string): unknown =>
    (v as { isLuxonDateTime?: unknown } | null | undefined)?.isLuxonDateTime === true ? (v as { toFormat(fmt: string): string }).toFormat(fmt) : v;

/**
 * A seat, whose field names are all reserved somewhere
 * generated from [Seat](../../contracts/reserved.ck#L18)
*/
export const Seat = z.strictObject({
    class: z.string(),
    from: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).optional(),
    date: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })),
    time: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'HH:mm:ss') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a time in format HH:mm:ss' })).optional(),
    copy: z.string().optional(),
    modelDump: z.string().optional(),
    json: z.string().optional(),
    in: z.string().optional(),
    is: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional(),
    object: z.string().optional(),
    default: z.string().optional(),
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

/** Seat as a request body sends it, with every `date`, `time` and `decimal` in the text the server parses. Returns a copy; `value` is not modified. */
export function serializeSeat(value: Seat): unknown {
    const __o0 = { ...value } as Record<string, unknown>;
    if (__o0["from"] != null) {
        __o0["from"] = __wireDt(__o0["from"], 'yyyy-MM-dd');
    }
    __o0["date"] = __wireDt(__o0["date"], 'yyyy-MM-dd');
    if (__o0["time"] != null) {
        __o0["time"] = __wireDt(__o0["time"], 'HH:mm:ss');
    }
    return __o0;
}

/**
 * Path params declared as a model whose field is a keyword, referenced via `params: SeatRef`
 * generated from [SeatRef](../../contracts/reserved.ck#L33)
*/
export const SeatRef = z.strictObject({
    class: z.string(),
});
export type SeatRef = z.infer<typeof SeatRef>;

/**
 * generated from [Note](../../contracts/reserved.ck#L37)
*/
export const Note = z.strictObject({
    text: z.string(),
});
export type Note = z.infer<typeof Note>;
