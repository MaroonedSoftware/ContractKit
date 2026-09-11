import { z } from 'zod';
import { DateTime, Duration } from 'luxon';
import { Decimal } from 'decimal.js';

const _ZodBinary = z.custom<Blob>((val) => val instanceof Blob, { error: 'Must be binary data' });
const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));
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
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};
const __dtf = (v: unknown, path: string, fmt: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected a string at '${path}' in format ${fmt}, received ${typeof v}.`);
    }
    const d = DateTime.fromFormat(v, fmt);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' does not match format ${fmt}.`);
    return d;
};
const __dur = (v: unknown, path: string): Duration => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 duration string at '${path}', received ${typeof v}.`);
    }
    const d = Duration.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 duration.`);
    return d;
};
/** A luxon DateTime in `fmt`, as the server's `DateTime.fromFormat` reads it. Anything else is returned as it is. */
const __wireDt = (v: unknown, fmt: string): unknown =>
    (v as { isLuxonDateTime?: unknown } | null | undefined)?.isLuxonDateTime === true ? (v as { toFormat(fmt: string): string }).toFormat(fmt) : v;
/** A decimal.js value in normal notation, which its `toString()` is not at every magnitude. Anything else is returned as it is. */
const __wireDec = (v: unknown): unknown =>
    (v as { toStringTag?: unknown } | null | undefined)?.toStringTag === '[object Decimal]' ? (v as { toFixed(): string }).toFixed() : v;

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

/** Rehydrates every wire-encoded scalar in a Payment into its runtime type. Mutates and returns `raw`. */
export function revivePayment(raw: Payment): Payment {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["unitPrice"] = __dec(__o0["unitPrice"], 'Payment.unitPrice');
    __o0["createdAt"] = __dt(__o0["createdAt"], 'Payment.createdAt');
    if (__o0["processingTime"] != null) {
        __o0["processingTime"] = __dur(__o0["processingTime"], 'Payment.processingTime');
    }
    return raw;
}

/** Payment as a request body sends it, with every `date`, `time` and `decimal` in the text the server parses. Returns a copy; `value` is not modified. */
export function serializePayment(value: PaymentInput): unknown {
    const __o0 = { ...value } as Record<string, unknown>;
    __o0["unitPrice"] = __wireDec(__o0["unitPrice"]);
    return __o0;
}

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

/** Rehydrates every wire-encoded scalar in a PaymentFilter into its runtime type. Mutates and returns `raw`. */
export function revivePaymentFilter(raw: PaymentFilter): PaymentFilter {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0["since"] != null) {
        __o0["since"] = __dt(__o0["since"], 'PaymentFilter.since');
    }
    return raw;
}

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
 * its own, so the router applies the block's object mode to the object inside it.
 * generated from [SnakeFilter](../../contracts/billing.ck#L229)
*/
export const SnakeFilter = z.strictObject({
    from_date: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).nullish(),
}).transform(data => ({
    ...(data.from_date != null ? { fromDate: data.from_date } : {}),
}));
export type SnakeFilter = z.output<typeof SnakeFilter>;

/** {@link SnakeFilter} as a request sends it, keyed the way the server's schema parses it. */
export interface SnakeFilterWireInput {
    from_date?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a SnakeFilter into its runtime type. Mutates and returns `raw`. */
export function reviveSnakeFilter(raw: SnakeFilter): SnakeFilter {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0["fromDate"] != null) {
        __o0["fromDate"] = __dtf(__o0["fromDate"], 'SnakeFilter.fromDate', 'yyyy-MM-dd');
    }
    return raw;
}

/** SnakeFilter as a request body sends it, with every `date`, `time` and `decimal` in the text the server parses. Returns a copy; `value` is not modified. */
export function serializeSnakeFilter(value: SnakeFilterWireInput): unknown {
    const __o0 = { ...value } as Record<string, unknown>;
    if (__o0["from_date"] != null) {
        __o0["from_date"] = __wireDt(__o0["from_date"], 'yyyy-MM-dd');
    }
    return __o0;
}

/**
 * generated from [SnakeHeaders](../../contracts/billing.ck#L233)
*/
export const SnakeHeaders = z.strictObject({
    tenant_id: z.string().nullish(),
}).transform(data => ({
    ...(data.tenant_id != null ? { tenantId: data.tenant_id } : {}),
}));
export type SnakeHeaders = z.output<typeof SnakeHeaders>;

/** {@link SnakeHeaders} as a request sends it, keyed the way the server's schema parses it. */
export interface SnakeHeadersWireInput {
    tenant_id?: string;
}

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
