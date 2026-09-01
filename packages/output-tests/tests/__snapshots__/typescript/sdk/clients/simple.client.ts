import type { Heartbeat } from '../types/simple.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';

/**
 * generated from [simple.ck](file://./../../contracts/simple.ck)
 */
export class SimpleClient {
    constructor(private fetch: SdkFetch) {}

    /** @description current service status */
    async getStatus(): Promise<Heartbeat> {
        const result = await this.fetch(`/status`, { method: 'GET' });
        return await parseJson<Heartbeat>(result);
    }
}
