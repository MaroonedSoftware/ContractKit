import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type { AdminCredentialInput, Credential, Payment, PaymentInput, PaymentRef, Session, SessionInput, UpdatePaymentForm } from '../types/billing.types.js';
import { revivePayment } from '../types/billing.types.js';

export class BillingClient {
    constructor(private fetch: SdkFetch) {
    }

    /** @description create a payment */
    async createPayment(body: PaymentInput): Promise<{ data: Payment; headers: { xRequestId: string; xRatelimitRemaining: number; xCacheHit?: boolean } }> {
        const result = await this.fetch(`/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        const data = revivePayment(await parseJson<Payment>(result));
        return { data, headers: { xRequestId: result.headers.get('x-request-id') ?? undefined, xRatelimitRemaining: result.headers.get('x-ratelimit-remaining') ?? undefined, xCacheHit: result.headers.get('x-cache-hit') ?? undefined } };
    }

    /** @description list payments */
    async listPayments(query?: { limit?: number; cursor?: string }, customHeaders?: { 'api-key'?: string; 'x-tenant'?: string }): Promise<Payment[]> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/payments${qs}`, {
            method: 'GET',
            headers: customHeaders,
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
        const result = await this.fetch(`/refunds/${encodeURIComponent(paymentId)}`, { method: 'GET' });
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
}
