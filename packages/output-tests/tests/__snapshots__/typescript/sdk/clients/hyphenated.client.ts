import type { Invoice } from '../types/hyphenated.types.js';
import { reviveInvoice } from '../types/hyphenated.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';

/**
 * generated from [hyphenated.ck](../../contracts/hyphenated.ck)
 */
export class HyphenatedClient {
    constructor(private fetch: SdkFetch) {}

    /** @description fetch an invoice */
    async getInvoice(invoice-id: string): Promise<Invoice> {
        const result = await this.fetch(`/invoices/{invoice-id}`, { method: 'GET' });
        return reviveInvoice(await parseJson<Invoice>(result));
    }
}
