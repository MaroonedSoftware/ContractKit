import type { ContractTypeNode, FieldNode, OpOperationNode, OpRootNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';
import { emittedResponses, observableResponses } from './response-sets.js';
import { classifyContentType } from './content-type.js';
import { extractPathParams } from './path-params.js';

/**
 * Warn when a route path contains `{param}` placeholders that are not explicitly declared in a
 * `params` block; when an operation declares responses but emits none of them; on empty or
 * invalid request body declarations; and on `application/x-www-form-urlencoded` bodies containing
 * nested object/array shapes, which don't round-trip cleanly through form encoding. Errors on a
 * `text/event-stream` declaration outside the one shape a streaming operation can take.
 */
export function validateOp(root: OpRootNode, diag: DiagnosticCollector): void {
    for (const route of root.routes) {
        const pathParams = extractPathParams(route.path);

        if (pathParams.length > 0) {
            if (!route.params) {
                for (const name of pathParams) {
                    diag.warn(root.file, route.loc.line, `Path parameter '{${name}}' is not explicitly defined in a params block`);
                }
            } else if (route.params.kind === 'ref' || route.params.kind === 'type') {
                // Type-reference or ContractTypeNode form — all params are covered by the type
            } else {
                const declared = new Set(route.params.nodes.map((p: { name: string }) => p.name));
                for (const name of pathParams) {
                    if (!declared.has(name)) {
                        diag.warn(root.file, route.loc.line, `Path parameter '{${name}}' is not explicitly defined in a params block`);
                    }
                }
            }
        }

        for (const op of route.operations) {
            // Above the request guard on purpose: an operation with no request body is the common
            // case for this warning, and skipping it would miss most of what it exists to catch.
            if (op.responses.length > 0 && emittedResponses(op).length === 0) {
                diag.warn(
                    root.file,
                    op.loc.line,
                    `Operation declares only non-emitted responses (${op.responses.map(r => r.statusCode).join(', ')}) — ` +
                        `the generated router will return 204. Add a block to the success status, e.g. '200: { … }' or a bare '204:'.`,
                    'no-emitted-response',
                );
            }

            validateEventStream(op, root, diag);

            if (!op.request) continue;
            if (op.request.bodies.length === 0) {
                diag.warn(root.file, op.loc.line, `Operation has an empty request block — declare at least one content type`);
                continue;
            }
            for (const body of op.request.bodies) {
                if (body.contentType !== 'application/x-www-form-urlencoded') continue;
                if (typeContainsNestedShape(body.bodyType, root)) {
                    diag.warn(
                        root.file,
                        op.loc.line,
                        `application/x-www-form-urlencoded body contains nested objects or arrays — these don't round-trip cleanly through form encoding`,
                    );
                }
            }
        }
    }
}

const isEventStream = (contentType: string) => classifyContentType(contentType) === 'event-stream';

/**
 * Hold a streaming operation to the one shape every generator can render.
 *
 * The SDK method returns an async iterable of events in place of a value and the router hands the
 * service an event sink in place of taking its return, so the stream has to be the operation's
 * only outcome the service writes (anything else, like a 404, it throws): a second success status, or a second mime beside the stream, would need
 * a client return type that is sometimes a stream and sometimes not. Each event's `data` is
 * JSON-encoded, so the body type is the schema of one event and cannot be `binary`. A request body
 * cannot stream at all.
 */
function validateEventStream(op: OpOperationNode, root: OpRootNode, diag: DiagnosticCollector): void {
    const error = (message: string) => diag.error(root.file, op.loc.line, message, 'event-stream');

    if (op.request?.bodies.some(b => isEventStream(b.contentType))) {
        error(`text/event-stream is a response type; a request body cannot stream`);
    }

    const streaming = op.responses.filter(r => r.bodies.some(b => isEventStream(b.contentType)));
    if (streaming.length === 0) return;
    if (streaming.length > 1) {
        error(
            `text/event-stream is declared on several statuses (${streaming.map(r => r.statusCode).join(', ')}), but a streaming operation has one stream`,
        );
        return;
    }

    const stream = streaming[0]!;
    if (stream.statusCode < 200 || stream.statusCode >= 300) {
        error(`text/event-stream on status ${stream.statusCode}: a stream must be a 2xx response`);
        return;
    }
    if (stream.emit === 'documented') {
        error(`text/event-stream on ${stream.statusCode}(documented): the service produces the stream, so it cannot be documentation only`);
        return;
    }
    if (stream.bodies.length > 1) {
        error(`status ${stream.statusCode} declares text/event-stream beside other content types, but a stream must be the status's only body`);
    }
    const others = observableResponses(op).filter(r => r !== stream);
    if (others.length > 0) {
        error(
            `a streaming operation cannot also return ${others.map(r => r.statusCode).join(', ')}. ` +
                `The service reports other outcomes by throwing, so declare them as bare error statuses or mark them (documented)`,
        );
    }
    const body = stream.bodies.find(b => isEventStream(b.contentType))!;
    if (body.bodyType.kind === 'scalar' && body.bodyType.name === 'binary') {
        error(
            `text/event-stream body is 'binary', but each event's data is JSON, so declare the event's schema (usually a model or discriminated union)`,
        );
    }
}

/**
 * True if `type` (resolved through model refs) contains any field whose type is itself
 * an object, inline object, array of object, or record of object.
 */
function typeContainsNestedShape(type: ContractTypeNode, root: OpRootNode, seen: Set<string> = new Set()): boolean {
    const fields = resolveFields(type, root, seen);
    if (!fields) return false;
    return fields.some(f => isNestedShape(f.type));
}

function isNestedShape(t: ContractTypeNode): boolean {
    if (t.kind === 'inlineObject') return true;
    if (t.kind === 'array') return t.item.kind === 'inlineObject' || t.item.kind === 'ref' || t.item.kind === 'record';
    if (t.kind === 'record') return true;
    if (t.kind === 'union' || t.kind === 'discriminatedUnion' || t.kind === 'intersection') return true;
    return false;
}

function resolveFields(type: ContractTypeNode, root: OpRootNode, seen: Set<string>): FieldNode[] | undefined {
    if (type.kind === 'inlineObject') return type.fields;
    if (type.kind === 'ref') {
        if (seen.has(type.name)) return undefined;
        seen.add(type.name);
        // OpRoot doesn't carry models; if running on a CkRoot the caller would resolve. For pure .op
        // contexts we can't resolve refs — be conservative and return undefined (no warning).
        return undefined;
    }
    return undefined;
}
