import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJsonWithBigInt as parseJson, buildQueryString, buildHeaders, readContentType } from '../sdk-options.js';
import type { Folder, Instrument, Shared, SharedInput, StampedOutput, StampedWireInput, TokenOutput, TokenWireInput } from '../types/kitchen.types.js';
import { reviveFolder, reviveStampedOutput } from '../types/kitchen.types.js';
import { DateTime } from 'luxon';

export class KitchenClient {
    constructor(private fetch: SdkFetch) {
    }

    /** @description several statuses, and two content types on one of them */
    async getFolder(folderId: string, query: { depth?: number; tags?: string[] }, customHeaders: { 'x-trace': string; 'x-opt'?: number }): Promise<
        | { status: 200; contentType: 'application/json'; data: Folder; headers: { xCount: number; xWhen?: DateTime } }
        | { status: 200; contentType: 'text/plain'; data: string; headers: { xCount: number; xWhen?: DateTime } }
        | { status: 204 }
        | { status: 404; contentType: 'application/json'; data: Shared }
    > {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/folders/${encodeURIComponent(folderId)}${qs}`, {
            method: 'GET',
            headers: buildHeaders(customHeaders),
            expectStatuses: [404],
        });
        switch (result.status) {
            case 204:
                return { status: 204 };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<Shared>(result) };
            default:
                switch (readContentType(result)) {
                    case 'text/plain':
                        return { status: 200, contentType: 'text/plain', data: await result.text(), headers: { xCount: Number(result.headers.get('x-count')), xWhen: result.headers.get('x-when') === null ? undefined : DateTime.fromISO(result.headers.get('x-when')!) } };
                    default:
                        return { status: 200, contentType: 'application/json', data: reviveFolder(await parseJson<Folder>(result)), headers: { xCount: Number(result.headers.get('x-count')), xWhen: result.headers.get('x-when') === null ? undefined : DateTime.fromISO(result.headers.get('x-when')!) } };
                }
        }
    }

    /** @description a method name that is a keyword in the target languages */
    async import(folderId: string, body: SharedInput): Promise<Instrument> {
        const result = await this.fetch(`/folders/${encodeURIComponent(folderId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Instrument>(result);
    }

    async stamp(body: StampedWireInput): Promise<StampedOutput> {
        const result = await this.fetch(`/stamps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveStampedOutput(await parseJson<StampedOutput>(result));
    }

    async mint(body: TokenWireInput): Promise<TokenOutput> {
        const result = await this.fetch(`/tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<TokenOutput>(result);
    }

    async listTokens(): Promise<TokenOutput[]> {
        const result = await this.fetch(`/tokens`, { method: 'GET' });
        return await parseJson<TokenOutput[]>(result);
    }
}
