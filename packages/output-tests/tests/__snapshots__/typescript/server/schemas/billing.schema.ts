import { z } from 'zod';
import { DateTime, Duration } from 'luxon';
import { Decimal } from 'decimal.js';

const _ZodBinary = z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' });
const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));
Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const _ZodDecimal = z.preprocess((val) => { if (typeof val !== 'string') return val; try { return new Decimal(val); } catch { return val; } }, z.custom<Decimal>((val) => Decimal.isDecimal(val), { message: 'Must be an exact decimal sent as a quoted string, e.g. "1250.00"' }));

/**
 * A customer payment
 * generated from [Payment](../../contracts/billing.ck#L11)
*/
export const Payment = z.strictObject({
    id: z.uuid(),
    amount: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0)),
    unitPrice: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' }),
    quantity: z.preprocess((val) => typeof val === 'string' && /^-?\d+n?$/.test(val) ? BigInt(val.replace(/n$/, '')) : val, z.bigint()),
    createdAt: _ZodDatetime,
    processingTime: z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid, { message: 'Must be an ISO 8601 duration' })).optional(),
    status: z.enum(["pending", "completed", "failed"]).default("pending"),
});
export type Payment = z.infer<typeof Payment>;

export const PaymentInput = z.strictObject({
    amount: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0)),
    unitPrice: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' }),
    quantity: z.preprocess((val) => typeof val === 'string' && /^-?\d+n?$/.test(val) ? BigInt(val.replace(/n$/, '')) : val, z.bigint()),
    createdAt: _ZodDatetime,
    processingTime: z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid, { message: 'Must be an ISO 8601 duration' })).optional(),
    status: z.enum(["pending", "completed", "failed"]).default("pending"),
});
export type PaymentInput = z.infer<typeof PaymentInput>;

/**
 * A stored credential — has a writeonly child, so its Base schema is read
 * generated from [Credential](../../contracts/billing.ck#L22)
*/
export const Credential = z.strictObject({
    id: z.uuid(),
});
export type Credential = z.infer<typeof Credential>;

export const CredentialInput = z.strictObject({
    secret: z.string(),
});
export type CredentialInput = z.infer<typeof CredentialInput>;

/**
 * A writeonly model nothing extends — its Base schema has no reader
 * generated from [Session](../../contracts/billing.ck#L34)
*/
export const Session = z.strictObject({
    id: z.string(),
});
export type Session = z.infer<typeof Session>;

export const SessionInput = z.strictObject({
    id: z.string(),
    refreshToken: z.string(),
});
export type SessionInput = z.infer<typeof SessionInput>;

/**
 * Path params declared as a model, referenced via `params: PaymentRef`
 * generated from [PaymentRef](../../contracts/billing.ck#L40)
*/
export const PaymentRef = z.strictObject({
    paymentId: z.uuid(),
});
export type PaymentRef = z.infer<typeof PaymentRef>;

/**
 * generated from [UpdatePaymentForm](../../contracts/billing.ck#L44)
*/
export const UpdatePaymentForm = z.strictObject({
    note: z.string().optional(),
});
export type UpdatePaymentForm = z.infer<typeof UpdatePaymentForm>;

/**
 * generated from [UploadReceiptForm](../../contracts/billing.ck#L48)
*/
export const UploadReceiptForm = z.strictObject({
    caption: z.string().optional(),
    file: _ZodBinary.optional(),
});
export type UploadReceiptForm = z.infer<typeof UploadReceiptForm>;

/**
 * Query params declared as a model, referenced via `query: PaymentFilter`
 * generated from [PaymentFilter](../../contracts/billing.ck#L54)
*/
export const PaymentFilter = z.strictObject({
    status: z.enum(["pending", "completed", "failed"]).optional(),
    since: _ZodDatetime.optional(),
    ids: z.array(z.uuid()).optional(),
});
export type PaymentFilter = z.infer<typeof PaymentFilter>;

/**
 * Request headers declared as a model. Header names are case-insensitive, so any casing of `xCorrelationId` matches.
 * generated from [TenantHeaders](../../contracts/billing.ck#L61)
*/
export const TenantHeaders = z.strictObject({
    'x-tenant': z.string(),
    xCorrelationId: z.string().optional(),
});
export type TenantHeaders = z.infer<typeof TenantHeaders>;

/**
 * Query params and headers declared as format() models. Each schema is a pipe with no `.strict()` of
 * its own, so the router applies the block's object mode to the object inside it. A query array is
 * split on commas there too, read off the object's shape under its snake_case key.
 * generated from [SnakeFilter](../../contracts/billing.ck#L230)
*/
export const SnakeFilter = z.strictObject({
    from_date: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).nullish(),
    tag_ids: z.array(z.uuid()).nullish(),
}).transform(data => ({
    ...(data.from_date != null ? { fromDate: data.from_date } : {}),
    ...(data.tag_ids != null ? { tagIds: data.tag_ids } : {}),
}));
export type SnakeFilter = z.output<typeof SnakeFilter>;

/**
 * generated from [SnakeHeaders](../../contracts/billing.ck#L235)
*/
export const SnakeHeaders = z.strictObject({
    tenant_id: z.string().nullish(),
}).transform(data => ({
    ...(data.tenant_id != null ? { tenantId: data.tenant_id } : {}),
}));
export type SnakeHeaders = z.output<typeof SnakeHeaders>;

/**
 * A format() member of an intersection has no `.extend()` or `.shape`, being a pipe. The router and the
 * schemas build the object from the member's own object (`SnakeFilter.in`) and end in one transform
 * that renames the member's keys through its `.out`, passing every other key through.
 * generated from [PaymentScope](../../contracts/billing.ck#L257)
*/
export const PaymentScope = z.strictObject({
    region: z.string(),
});
export type PaymentScope = z.infer<typeof PaymentScope>;

/**
 * Extends a writeonly base and is itself writeonly
 * generated from [AdminCredential](../../contracts/billing.ck#L28)
*/
export const AdminCredential = Credential.extend({
    scope: z.string(),
});
export type AdminCredential = z.infer<typeof AdminCredential>;

export const AdminCredentialInput = CredentialInput.extend({
    scope: z.string(),
    token: z.string(),
});
export type AdminCredentialInput = z.infer<typeof AdminCredentialInput>;

/**
 * A field typed as one
 * generated from [SavedSearch](../../contracts/billing.ck#L265)
*/
export const SavedSearch = z.strictObject({
    label: z.string(),
    filter: SnakeFilter.in.extend({
    q: z.string(),
}).transform(({ from_date: _0, tag_ids: _1, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0, tag_ids: _1 }),
})),
});
export type SavedSearch = z.infer<typeof SavedSearch>;

/**
 * An alias of such an intersection, which is a pipe itself
 * generated from [ScopedFilter](../../contracts/billing.ck#L262)
*/
export const ScopedFilter = SnakeFilter.in.extend(PaymentScope.shape).transform(({ from_date: _0, tag_ids: _1, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0, tag_ids: _1 }),
}));
export type ScopedFilter = z.infer<typeof ScopedFilter>;
