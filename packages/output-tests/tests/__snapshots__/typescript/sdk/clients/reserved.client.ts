import type { Note, Seat, SeatRef } from '../types/reserved.types.js';
import { reviveSeat } from '../types/reserved.types.js';
import { DateTime } from 'luxon';
import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString, buildHeaders } from '../sdk-options.js';

/**
 * generated from [reserved.ck](../../contracts/reserved.ck)
 */
export class ReservedClient {
    constructor(private fetch: SdkFetch) {}

    /** @description fetch one seat */
    async getSeat(class_: string, query?: { from?: DateTime; in?: string; pageSize?: number }, customHeaders?: { from?: string }): Promise<{ data: Seat; headers: { from?: string } }> {
        const qs = buildQueryString({ ...query, from: query?.from?.toFormat('yyyy-MM-dd') });
        const result = await this.fetch(`/seats/${encodeURIComponent(class_)}${qs}`, {
            method: 'GET',
            headers: buildHeaders(customHeaders),
        });
        const data = reviveSeat(await parseJson<Seat>(result));
        return { data, headers: { from: result.headers.get('from') ?? undefined } };
    }

    /** @description fetch a row by its seat class */
    async getRow(params: SeatRef): Promise<Seat> {
        const result = await this.fetch(`/rows/${encodeURIComponent(String(params.class))}`, { method: 'GET' });
        return reviveSeat(await parseJson<Seat>(result));
    }

    /** @description replace a note */
    async putNote(body_: string, body: Note): Promise<Note> {
        const result = await this.fetch(`/notes/${encodeURIComponent(body_)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Note>(result);
    }
}
