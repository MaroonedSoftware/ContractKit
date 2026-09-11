import type { Seat, SeatRef } from '../types/reserved.types.js';
import { reviveSeat } from '../types/reserved.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';

/**
 * generated from [reserved.ck](../../contracts/reserved.ck)
 */
export class ReservedClient {
    constructor(private fetch: SdkFetch) {}

    /** @description fetch one seat */
    async getSeat(seatId: string, query?: { from?: string; pageSize?: number }): Promise<{ data: Seat; headers: { from?: string } }> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/seats/${encodeURIComponent(seatId)}${qs}`, {
            method: 'GET',
        });
        const data = reviveSeat(await parseJson<Seat>(result));
        return { data, headers: { from: result.headers.get('from') ?? undefined } };
    }

    /** @description fetch a row by its seat class */
    async getRow(params: SeatRef): Promise<Seat> {
        const result = await this.fetch(`/rows/${encodeURIComponent(String(params.class))}`, { method: 'GET' });
        return reviveSeat(await parseJson<Seat>(result));
    }
}
