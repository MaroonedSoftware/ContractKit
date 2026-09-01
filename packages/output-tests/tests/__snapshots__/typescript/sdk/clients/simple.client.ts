import type { Heartbeat } from '../types/simple.types.js';
import { reviveHeartbeat } from '../types/simple.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';

/**
 * generated from [simple.ck](../../contracts/simple.ck)
 */
export class SimpleClient {
    constructor(private fetch: SdkFetch) {}

    /** @description current service status */
    async getStatus(): Promise<Heartbeat> {
        const result = await this.fetch(`/status`, { method: 'GET' });
        return reviveHeartbeat(await parseJson<Heartbeat>(result));
    }
}
