import { z } from 'zod';
import { DateTime, Duration } from 'luxon';
import { Decimal } from 'decimal.js';

const _ZodBinary = z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' });
const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));
Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const _ZodDecimal = z.preprocess((val) => { if (typeof val !== 'string') return val; try { return new Decimal(val); } catch { return val; } }, z.custom<Decimal>((val) => Decimal.isDecimal(val), { message: 'Must be an exact decimal sent as a quoted string, e.g. "1250.00"' }));

/**
 * A customer payment
 * generated from [Payment](file://./../../contracts/billing.ck#L11)
*/
export const Payment = z.strictObject({
    id: z.uuid(),
    amount: z.coerce.number().min(0),
    unitPrice: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' }),
    quantity: z.preprocess((val) => typeof val === 'string' ? BigInt(val.replace(/n$/, '')) : val, z.bigint()),
    createdAt: _ZodDatetime,
    processingTime: z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid, { message: 'Must be an ISO 8601 duration' })).optional(),
    status: z.enum(["pending", "completed", "failed"]).default("pending"),
});
export type Payment = z.infer<typeof Payment>;

export const PaymentInput = z.strictObject({
    amount: z.coerce.number().min(0),
    unitPrice: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' }),
    quantity: z.preprocess((val) => typeof val === 'string' ? BigInt(val.replace(/n$/, '')) : val, z.bigint()),
    createdAt: _ZodDatetime,
    processingTime: z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid, { message: 'Must be an ISO 8601 duration' })).optional(),
    status: z.enum(["pending", "completed", "failed"]).default("pending"),
});
export type PaymentInput = z.infer<typeof PaymentInput>;

/**
 * A stored credential — has a writeonly child, so its Base schema is read
 * generated from [Credential](file://./../../contracts/billing.ck#L22)
*/
const CredentialBase = z.strictObject({
    id: z.uuid(),
    secret: z.string(),
});

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
 * generated from [Session](file://./../../contracts/billing.ck#L34)
*/
const SessionBase = z.strictObject({
    id: z.string(),
    refreshToken: z.string(),
});

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
 * generated from [PaymentRef](file://./../../contracts/billing.ck#L40)
*/
export const PaymentRef = z.strictObject({
    paymentId: z.uuid(),
});
export type PaymentRef = z.infer<typeof PaymentRef>;

/**
 * generated from [UpdatePaymentForm](file://./../../contracts/billing.ck#L44)
*/
export const UpdatePaymentForm = z.strictObject({
    note: z.string().optional(),
});
export type UpdatePaymentForm = z.infer<typeof UpdatePaymentForm>;

/**
 * generated from [UploadReceiptForm](file://./../../contracts/billing.ck#L48)
*/
export const UploadReceiptForm = z.strictObject({
    caption: z.string().optional(),
    file: _ZodBinary.optional(),
});
export type UploadReceiptForm = z.infer<typeof UploadReceiptForm>;

/**
 * Extends a writeonly base and is itself writeonly
 * generated from [AdminCredential](file://./../../contracts/billing.ck#L28)
*/
const AdminCredentialBase = CredentialBase.extend({
    scope: z.string(),
    token: z.string(),
});

export const AdminCredential = Credential.extend({
    scope: z.string(),
});
export type AdminCredential = z.infer<typeof AdminCredential>;

export const AdminCredentialInput = CredentialInput.extend({
    scope: z.string(),
    token: z.string(),
});
export type AdminCredentialInput = z.infer<typeof AdminCredentialInput>;
