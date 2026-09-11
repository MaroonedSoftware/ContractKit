import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJsonWithBigInt as parseJson, buildQueryString, buildHeaders } from '../sdk-options.js';
import type { AdminCredentialInput, Credential, Payment, PaymentFilter, PaymentInput, PaymentRef, PaymentScope, SavedSearch, ScopedFilterWireInput, Session, SessionInput, SnakeFilter, SnakeFilterWireInput, SnakeHeadersWireInput, TenantHeaders, UpdatePaymentForm } from '../types/billing.types.js';
import { revivePayment, reviveSavedSearch, reviveSnakeFilter, serializePayment, serializeSnakeFilter } from '../types/billing.types.js';
import { DateTime } from 'luxon';


/** Rehydrates the `decimal` fields of one response body. Mutates and returns `raw`. */
function __reviveSearchPaymentsScoped200(raw: SnakeFilter & { q: string }): SnakeFilter & { q: string } {
    const __v = [raw] as unknown[];
    reviveSnakeFilter(__v[0] as never);
    return __v[0] as SnakeFilter & { q: string };
}

/** One request body as it is sent, with every `date`, `time` and `decimal` in the text the server parses. Returns a copy. */
function __serializeSaveScopedSearchBody(value: PaymentScope & SnakeFilterWireInput): unknown {
    let __v: unknown = value;
    __v = serializeSnakeFilter(__v as never);
    return __v;
}

export class BillingClient {
    constructor(private fetch: SdkFetch) {
    }

    /** @description create a payment */
    async createPayment(body: PaymentInput): Promise<{ data: Payment; headers: { xRequestId: string; xRatelimitRemaining: number; xCacheHit?: boolean; xExpiresAfter?: DateTime } }> {
        const result = await this.fetch(`/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serializePayment(body), bigIntReplacer),
        });
        const data = revivePayment(await parseJson<Payment>(result));
        return { data, headers: { xRequestId: result.headers.get('x-request-id')!, xRatelimitRemaining: Number(result.headers.get('x-ratelimit-remaining')), xCacheHit: result.headers.get('x-cache-hit') === null ? undefined : result.headers.get('x-cache-hit') === 'true', xExpiresAfter: result.headers.get('x-expires-after') === null ? undefined : DateTime.fromISO(result.headers.get('x-expires-after')!) } };
    }

    /** @description list payments */
    async listPayments(query: { limit?: number; cursor: string; status?: 'pending' | 'completed' | 'failed' }, customHeaders: { 'api-key'?: string; 'x-tenant': string }): Promise<Payment[]> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/payments${qs}`, {
            method: 'GET',
            headers: buildHeaders(customHeaders),
        });
        return (await parseJson<Payment[]>(result)).map(revivePayment);
    }

    /** @description search payments with a filter model */
    async searchPayments(query?: PaymentFilter, customHeaders?: TenantHeaders): Promise<Payment[]> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/payments/search${qs}`, {
            method: 'GET',
            headers: buildHeaders(customHeaders),
        });
        return (await parseJson<Payment[]>(result)).map(revivePayment);
    }

    /** @description create several payments at once */
    async createPayments(body: PaymentInput[]): Promise<Payment[]> {
        const result = await this.fetch(`/payments/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body.map(serializePayment), bigIntReplacer),
        });
        return (await parseJson<Payment[]>(result)).map(revivePayment);
    }

    /** @description fetch one payment */
    async getPayment(paymentId: string): Promise<Payment> {
        const result = await this.fetch(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
        return revivePayment(await parseJson<Payment>(result));
    }

    /** @description update a payment with form data */
    async updatePaymentWithForm(paymentId: string, body: UpdatePaymentForm): Promise<void> {
        await this.fetch(`/payments/${encodeURIComponent(paymentId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body as unknown as Record<string, string>).toString(),
        });
    }

    /** @description delete a payment — declares only a documented error status */
    async deletePayment(paymentId: string): Promise<void> {
        await this.fetch(`/payments/${encodeURIComponent(paymentId)}`, { method: 'DELETE' });
    }

    /** @description upload a receipt image */
    async uploadReceipt(paymentId: string, body: FormData): Promise<Payment> {
        const result = await this.fetch(`/payments/${encodeURIComponent(paymentId)}/receipt`, {
            method: 'POST',
            body: body,
        });
        return revivePayment(await parseJson<Payment>(result));
    }

    /**
     * @description look up a refund by its originating payment
     * @deprecated
     */
    async getRefund(params: PaymentRef): Promise<Payment> {
        const result = await this.fetch(`/refunds/${encodeURIComponent(String(params.paymentId))}`, { method: 'GET' });
        return revivePayment(await parseJson<Payment>(result));
    }

    /** @description store a credential */
    async createCredential(body: AdminCredentialInput): Promise<Credential> {
        const result = await this.fetch(`/credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Credential>(result);
    }

    /** @description open a session */
    async createSession(body: SessionInput): Promise<Session> {
        const result = await this.fetch(`/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Session>(result);
    }

    /** @description search payments with snake_case filter and header models */
    async searchPaymentsByDate(query?: SnakeFilterWireInput, customHeaders?: SnakeHeadersWireInput): Promise<void> {
        const qs = buildQueryString({ ...query, from_date: query?.from_date?.toFormat('yyyy-MM-dd') });
        await this.fetch(`/payments/by-date${qs}`, {
            method: 'GET',
            headers: buildHeaders(customHeaders),
        });
    }

    /** @description search payments with a snake_case filter extended inline */
    async searchPaymentsScoped(query?: SnakeFilterWireInput & { q: string }, customHeaders?: SnakeHeadersWireInput & { xTrace?: string }): Promise<SnakeFilter & { q: string }> {
        const qs = buildQueryString({ ...query, from_date: query?.from_date?.toFormat('yyyy-MM-dd') });
        const result = await this.fetch(`/payments/by-date/scoped${qs}`, {
            method: 'GET',
            headers: buildHeaders(customHeaders),
        });
        return __reviveSearchPaymentsScoped200(await parseJson<SnakeFilter & { q: string }>(result));
    }

    /** @description save a scoped search */
    async saveScopedSearch(body: PaymentScope & SnakeFilterWireInput, query?: ScopedFilterWireInput): Promise<SavedSearch> {
        const qs = buildQueryString({ ...query, from_date: query?.from_date?.toFormat('yyyy-MM-dd') });
        const result = await this.fetch(`/payments/by-date/scoped${qs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(__serializeSaveScopedSearchBody(body), bigIntReplacer),
        });
        return reviveSavedSearch(await parseJson<SavedSearch>(result));
    }
}
