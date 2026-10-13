import type { SdkFetch, SseEventStream, SseRequestOptions } from '../sdk-options.js';
import { parseSse, sseRequestHeaders, bigIntReviver } from '../sdk-options.js';
import type { ChatStreamEvent } from '../types/stream.types.js';

export class ChatClient {
    constructor(private fetch: SdkFetch) {
    }

    async streamConversation(id: string, requestOptions?: SseRequestOptions): Promise<SseEventStream<ChatStreamEvent>> {
        const result = await this.fetch(`/conversations/${encodeURIComponent(id)}/stream`, {
            method: 'GET',
            headers: sseRequestHeaders(requestOptions),
            signal: requestOptions?.signal,
        });
        return parseSse<ChatStreamEvent>(result, data => JSON.parse(data, bigIntReviver) as ChatStreamEvent);
    }
}
