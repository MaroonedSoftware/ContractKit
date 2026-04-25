import type { ContractTypeNode, FieldNode, OpRootNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

/** Extract `{paramName}` segments from a route path. */
function extractPathParams(path: string): string[] {
    return [...path.matchAll(/\{(\w+)\}/g)].map(m => m[1]!);
}

/**
 * Warn when a route path contains `{param}` placeholders that are not
 * explicitly declared in a `params` block; warn on empty/invalid request body
 * declarations and on `application/x-www-form-urlencoded` bodies that contain
 * nested object/array shapes (which don't round-trip cleanly through
 * URL-encoded form encoding).
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
