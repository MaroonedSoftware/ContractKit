/**
 * Which declared responses the service produces, which a client can receive as a value, and
 * which reach a client as a thrown error.
 *
 * Every consumer — the Koa router, the TypeScript and Python SDKs, OpenAPI and the docs
 * plugins — derives its shape from these three functions rather than re-deriving the rule, so
 * a contract cannot mean one thing to the server and another to the client.
 *
 * The derivation is one line: **a status is emitted if it has a block, or is 2xx.** Writing
 * `{ … }` says this is what the response consists of, which only the service is in a position
 * to produce; writing nothing after the colon says the status is documented and something else
 * produces it. A bare bodyless 2xx is the one carve-out — `204:` is a real outcome the handler
 * chooses. `(documented)` overrides the derivation in the one direction structure cannot
 * express: forcing a block-carrying status back out.
 *
 * Each function takes an operation node and nothing else. Options-level responses, when they
 * arrive, therefore merge upstream in `applyOptionsDefaults` and every consumer picks them up
 * unchanged.
 */
import type { OpOperationNode, OpResponseBodyNode, OpResponseNode, OpRootNode, OpRouteNode } from './ast.js';
import { resolveModifiers } from './ast.js';
import { classifyContentType } from './content-type.js';

/**
 * True when the generated router writes this response and the service returns it.
 *
 * A declared body implies a block for anything the parser produces, but nodes built
 * programmatically (`openapi-to-ck`, tests) may set bodies without `hasBlock`, so both are
 * checked rather than trusting one to stand in for the other.
 */
function isEmitted(resp: OpResponseNode): boolean {
    if (resp.emit === 'documented') return false;
    if (resp.hasBlock || resp.bodies.length > 0) return true;
    return resp.statusCode >= 200 && resp.statusCode < 300;
}

function byStatusCode(a: OpResponseNode, b: OpResponseNode): number {
    return a.statusCode - b.statusCode;
}

/**
 * The responses the service returns and the router writes, status-sorted.
 *
 * Sorted rather than left in source order so that generated output does not depend on where a
 * response was authored — an options-level default merged in later must not reorder a `switch`.
 */
export function emittedResponses(op: OpOperationNode): OpResponseNode[] {
    return op.responses.filter(isEmitted).sort(byStatusCode);
}

/**
 * The responses a client receives as a value rather than an exception, status-sorted.
 *
 * Every emitted response, plus every non-emitted response under 400: a `304` produced by
 * conditional-GET middleware is a legitimate outcome the client must handle, even though the
 * service never writes it. This is deliberately wider than {@link emittedResponses}.
 */
export function observableResponses(op: OpOperationNode): OpResponseNode[] {
    return op.responses.filter(r => isEmitted(r) || r.statusCode < 400).sort(byStatusCode);
}

/**
 * The responses that reach a client as a thrown error, status-sorted.
 *
 * The complement of {@link observableResponses}: non-emitted 4xx and 5xx. Their declared bodies
 * are the error-payload contract, which the SDK surfaces as the `SdkError` body type.
 */
export function thrownResponses(op: OpOperationNode): OpResponseNode[] {
    return op.responses.filter(r => !isEmitted(r) && r.statusCode >= 400).sort(byStatusCode);
}

/**
 * True when a `(documented)` modifier changes nothing, because the status would not be emitted
 * anyway — a bare bodyless 3xx/4xx/5xx. Surfaced as a warning so the author is not left thinking
 * the marker is doing work.
 */
export function isRedundantDocumented(resp: OpResponseNode): boolean {
    if (resp.emit !== 'documented') return false;
    return !resp.hasBlock && resp.bodies.length === 0 && !(resp.statusCode >= 200 && resp.statusCode < 300);
}

/**
 * The Server-Sent Events response of a streaming operation, or `undefined` for an ordinary one.
 *
 * An operation streams when an emitted status declares a `text/event-stream` body. `validateOp`
 * holds such an operation to one shape (the stream is the only body at a 2xx status, and no other
 * status is a non-error outcome), so generators can take the first match and treat the operation
 * as a stream of `body.bodyType` events.
 */
export function eventStreamResponse(op: OpOperationNode): { response: OpResponseNode; body: OpResponseBodyNode } | undefined {
    for (const response of emittedResponses(op)) {
        const body = response.bodies.find(b => classifyContentType(b.contentType) === 'event-stream');
        if (body) return { response, body };
    }
    return undefined;
}

/**
 * Every streaming operation in a file, with its route, for a generator that has to report the
 * ones it cannot render. Internal operations are skipped unless `includeInternal` is set, matching
 * which operations an SDK emits a method for.
 */
export function eventStreamOperations(root: OpRootNode, includeInternal = false): { route: OpRouteNode; op: OpOperationNode }[] {
    const found: { route: OpRouteNode; op: OpOperationNode }[] = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            if (eventStreamResponse(op)) found.push({ route, op });
        }
    }
    return found;
}
