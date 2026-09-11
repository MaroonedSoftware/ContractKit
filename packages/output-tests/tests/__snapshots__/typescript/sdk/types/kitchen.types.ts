import { z } from 'zod';
import { DateTime, Duration } from 'luxon';
import { Decimal } from 'decimal.js';

const _ZodBinary = z.custom<Blob>((val) => val instanceof Blob, { error: 'Must be binary data' });
const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));
Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const _ZodDecimal = z.preprocess((val) => { if (typeof val !== 'string') return val; try { return new Decimal(val); } catch { return val; } }, z.custom<Decimal>((val) => Decimal.isDecimal(val), { message: 'Must be an exact decimal sent as a quoted string, e.g. "1250.00"' }));
type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };
const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]));

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

/**
 * A named enum, so a field default has to resolve to a member rather than its wire spelling
 * generated from [Rating](../../contracts/kitchen.ck#L16)
*/
export const Rating = z.enum(["good", "neutral", "bad"]);
export type Rating = z.infer<typeof Rating>;

/**
 * generated from [Doc](../../contracts/kitchen.ck#L48)
*/
export const Doc = z.strictObject({
    id: z.uuid(),
    get folder() { return Folder.optional(); },
});
export type Doc = z.infer<typeof Doc>;

/** Rehydrates every wire-encoded scalar in a Doc into its runtime type. Mutates and returns `raw`. */
export function reviveDoc(raw: Doc): Doc {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0["folder"] != null) {
        reviveFolder(__o0["folder"] as never);
    }
    return raw;
}

/**
 * generated from [Card](../../contracts/kitchen.ck#L53)
*/
export const Card = z.strictObject({
    kind: z.literal("card"),
    last4: z.string().length(4),
});
export type Card = z.infer<typeof Card>;

/**
 * generated from [Bank](../../contracts/kitchen.ck#L58)
*/
export const Bank = z.strictObject({
    kind: z.literal("bank"),
    iban: z.string(),
});
export type Bank = z.infer<typeof Bank>;

/**
 * Decodes snake_case keys and encodes PascalCase ones
 * generated from [Token](../../contracts/kitchen.ck#L66)
*/
export const Token = z.strictObject({
    AccessToken: z.string(),
    ExpiresIn: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).default(3600),
}).transform(data => ({
    access_token: data.AccessToken,
    ...(data.ExpiresIn != null ? { expires_in: data.ExpiresIn } : {}),
}));
export type Token = z.output<typeof Token>;
export type TokenOutput = z.output<typeof Token>;

/** {@link Token} as a request sends it, keyed the way the server's schema parses it. */
export interface TokenWireInput {
    AccessToken: string;
    ExpiresIn?: number;
}

/**
 * generated from [Owned](../../contracts/kitchen.ck#L71)
*/
export const Owned = z.strictObject({
    id: z.uuid(),
});
export type Owned = z.infer<typeof Owned>;

export const OwnedInput = z.strictObject({
    secret: z.string(),
});
export type OwnedInput = z.infer<typeof OwnedInput>;

/**
 * generated from [Named](../../contracts/kitchen.ck#L76)
*/
export const Named = z.strictObject({
    name: z.string(),
});
export type Named = z.infer<typeof Named>;

/**
 * generated from [Stamp](../../contracts/kitchen.ck#L86)
*/
export const Stamp = z.strictObject({
    stampedBy: z.string(),
    stampedAt: _ZodDatetime,
});
export type Stamp = z.infer<typeof Stamp>;

/** Rehydrates every wire-encoded scalar in a Stamp into its runtime type. Mutates and returns `raw`. */
export function reviveStamp(raw: Stamp): Stamp {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["stampedAt"] = __dt(__o0["stampedAt"], 'Stamp.stampedAt');
    return raw;
}

/**
 * A plain base under format(), which the schema inlines rather than extends
 * generated from [Stamped](../../contracts/kitchen.ck#L92)
*/
export const Stamped = z.strictObject({
    stamped_by: z.string(),
    stamped_at: _ZodDatetime,
    stamp_note: z.string().nullish(),
}).transform(data => ({
    StampedBy: data.stamped_by,
    StampedAt: data.stamped_at,
    ...(data.stamp_note != null ? { StampNote: data.stamp_note } : {}),
}));
export type Stamped = z.output<typeof Stamped>;
export type StampedOutput = z.output<typeof Stamped>;

/** {@link Stamped} as a request sends it, keyed the way the server's schema parses it. */
export interface StampedWireInput {
    stamped_by: string;
    stamped_at: DateTime;
    stamp_note?: string;
}

/** Rehydrates every wire-encoded scalar in a Stamped into its runtime type. Mutates and returns `raw`. */
export function reviveStamped(raw: Stamped): Stamped {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["stampedAt"] = __dt(__o0["stampedAt"], 'Stamped.stampedAt');
    return raw;
}

/** Rehydrates every wire-encoded scalar in a StampedOutput into its runtime type. Mutates and returns `raw`. */
export function reviveStampedOutput(raw: StampedOutput): StampedOutput {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["StampedAt"] = __dt(__o0["StampedAt"], 'Stamped.StampedAt');
    return raw;
}

/**
 * format() on a contract split for readonly and writeonly fields, applied to both of its schemas
 * generated from [Ledger](../../contracts/kitchen.ck#L97)
*/
export const Ledger = z.strictObject({
    id: z.uuid(),
    posted_at: _ZodDatetime,
}).transform(data => ({
    Id: data.id,
    PostedAt: data.posted_at,
}));
export type Ledger = z.output<typeof Ledger>;

export const LedgerInput = z.strictObject({
    entry_code: z.string(),
    posted_at: _ZodDatetime,
}).transform(data => ({
    EntryCode: data.entry_code,
    PostedAt: data.posted_at,
}));
export type LedgerInput = z.output<typeof LedgerInput>;
export type LedgerOutput = z.output<typeof Ledger>;

/** {@link Ledger} as a request sends it, keyed the way the server's schema parses it. */
export interface LedgerWireInput {
    entry_code: string;
    posted_at: DateTime;
}

/** Rehydrates every wire-encoded scalar in a Ledger into its runtime type. Mutates and returns `raw`. */
export function reviveLedger(raw: Ledger): Ledger {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["postedAt"] = __dt(__o0["postedAt"], 'Ledger.postedAt');
    return raw;
}

/** Rehydrates every wire-encoded scalar in a LedgerOutput into its runtime type. Mutates and returns `raw`. */
export function reviveLedgerOutput(raw: LedgerOutput): LedgerOutput {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0["PostedAt"] = __dt(__o0["PostedAt"], 'Ledger.PostedAt');
    return raw;
}

/**
 * Self recursion through lazy(), mutual recursion through Doc, every container, both union
 * forms, every scalar, and field names that are keywords in the target languages
 * generated from [Folder](../../contracts/kitchen.ck#L20)
*/
export const Folder = z.strictObject({
    id: z.uuid(),
    class: z.string(),
    default: z.string().optional(),
    rating: Rating.default("neutral"),
    get parent() { return Folder.optional(); },
    readme: Doc.optional(),
    get children() { return z.array(Folder); },
    get byName() { return z.record(z.string(), Folder).optional(); },
    span: z.tuple([z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()), z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())]).optional(),
    stamped: z.tuple([z.uuid(), _ZodDatetime, z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean())]).optional(),
    label: z.union([z.string(), z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())]),
    get pinned() { return z.union([Doc, Folder]).nullable(); },
    instrument: z.union([Card, Bank]).optional(),
    origin: z.strictObject({
    x: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()),
    y: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()),
}).optional(),
    size: z.preprocess((val) => typeof val === 'string' && /^-?\d+n?$/.test(val) ? BigInt(val.replace(/n$/, '')) : val, z.bigint()),
    price: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2, { message: 'Must be at most 2 decimal places' }),
    day: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).optional(),
    at: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'HH:mm:ss') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a time in format HH:mm:ss' })).optional(),
    ttl: z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => val instanceof Duration && val.isValid, { message: 'Must be an ISO 8601 duration' })).optional(),
    blob: _ZodBinary.optional(),
    extra: z.unknown().optional(),
    raw: _ZodJson.optional(),
});
export type Folder = z.infer<typeof Folder>;

/** Rehydrates every wire-encoded scalar in a Folder into its runtime type. Mutates and returns `raw`. */
export function reviveFolder(raw: Folder): Folder {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0["parent"] != null) {
        reviveFolder(__o0["parent"] as never);
    }
    if (__o0["readme"] != null) {
        reviveDoc(__o0["readme"] as never);
    }
    {
        const __a1 = __o0["children"] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveFolder(__a1[__i2] as never);
        }
    }
    if (__o0["byName"] != null) {
        {
            const __r3 = __o0["byName"] as Record<string, unknown>;
            for (const __k4 of Object.keys(__r3)) {
                reviveFolder(__r3[__k4] as never);
            }
        }
    }
    if (__o0["stamped"] != null) {
        (__o0["stamped"] as unknown[])[1] = __dt((__o0["stamped"] as unknown[])[1], 'Folder.stamped[1]');
    }
    if (__o0["pinned"] != null) {
        reviveDoc(__o0["pinned"] as never);
    }
    __o0["price"] = __dec(__o0["price"], 'Folder.price');
    if (__o0["day"] != null) {
        __o0["day"] = __dtf(__o0["day"], 'Folder.day', 'yyyy-MM-dd');
    }
    if (__o0["at"] != null) {
        __o0["at"] = __dtf(__o0["at"], 'Folder.at', 'HH:mm:ss');
    }
    if (__o0["ttl"] != null) {
        __o0["ttl"] = __dur(__o0["ttl"], 'Folder.ttl');
    }
    return raw;
}

/**
 * generated from [Instrument](../../contracts/kitchen.ck#L63)
*/
export const Instrument = z.discriminatedUnion("kind", [Card, Bank]);
export type Instrument = z.infer<typeof Instrument>;

/**
 * Two flattened bases, split into a read and an input shape
 * generated from [Shared](../../contracts/kitchen.ck#L81)
*/
export const Shared = Owned.extend(Named.shape).extend({
    label: z.string().default("x"),
    instrument: Instrument.optional(),
});
export type Shared = z.infer<typeof Shared>;

export const SharedInput = OwnedInput.extend(Named.shape).extend({
    label: z.string().default("x"),
    instrument: Instrument.optional(),
});
export type SharedInput = z.infer<typeof SharedInput>;
