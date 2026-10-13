import { z } from 'zod';

/**
 * A token of the reply as it is generated
 * generated from [ChatDelta](../../contracts/stream.ck)
*/
export const ChatDelta = z.strictObject({
    type: z.literal("delta"),
    text: z.string(),
});
export type ChatDelta = z.infer<typeof ChatDelta>;

/**
 * The reply is complete
 * generated from [ChatDone](../../contracts/stream.ck)
*/
export const ChatDone = z.strictObject({
    type: z.literal("done"),
    tokens: z.preprocess((val) => typeof val === 'string' && /^-?\d+n?$/.test(val) ? BigInt(val.replace(/n$/, '')) : val, z.bigint()).describe("Total tokens, a bigint so each event goes through the reviver"),
});
export type ChatDone = z.infer<typeof ChatDone>;

/**
 * generated from [ChatStreamEvent](../../contracts/stream.ck)
*/
export const ChatStreamEvent = z.discriminatedUnion("type", [ChatDelta, ChatDone]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEvent>;
