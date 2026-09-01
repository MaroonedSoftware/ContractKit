import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));

const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * A service heartbeat — deliberately no bigint field and no `area` key
 * generated from [Heartbeat](../../contracts/simple.ck#L8)
*/
export const Heartbeat = z.strictObject({
    status: z.string(),
    checkedAt: _ZodDatetime,
});
export type Heartbeat = z.infer<typeof Heartbeat>;

/** Rehydrates every wire-encoded scalar in a Heartbeat into its runtime type. Mutates and returns `raw`. */
export function reviveHeartbeat(raw: Heartbeat): Heartbeat {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["checkedAt"] = __dt(__o0["checkedAt"], 'Heartbeat.checkedAt');
    return raw;
}
