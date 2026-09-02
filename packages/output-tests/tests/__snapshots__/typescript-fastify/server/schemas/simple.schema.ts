import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));

/**
 * A service heartbeat — deliberately no bigint field and no `area` key
 * generated from [Heartbeat](../../contracts/simple.ck#L8)
*/
export const Heartbeat = z.strictObject({
    status: z.string(),
    checkedAt: _ZodDatetime,
});
export type Heartbeat = z.infer<typeof Heartbeat>;
