import { describe, it, expect } from 'vitest';
import { parseCk } from '../src/parser.js';
import { applyOptionsDefaults } from '../src/apply-options-defaults.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import type { CkRootNode, OpParamNode } from '../src/ast.js';

function normalize(source: string): { root: CkRootNode; diag: DiagnosticCollector } {
    const diag = new DiagnosticCollector();
    const root = parseCk(source, 'test.ck', diag);
    applyOptionsDefaults(root, diag);
    return { root, diag };
}

const BASE_OP = `
operation /widgets: {
    get: {
        response: {
            200: { application/json: Widget }
            404:
        }
    }
}
`;

describe('applyOptionsDefaults — request headers', () => {
    it('merges global request headers into an op with no headers block', () => {
        const { root, diag } = normalize(`
            options {
                request: { headers: {
                    x-request-id: uuid
                    authorization?: string
                } }
            }
            ${BASE_OP}
        `);
        expect(diag.hasErrors()).toBe(false);
        const op = root.routes[0]!.operations[0]!;
        expect(op.headers?.kind).toBe('params');
        const names = (op.headers as { kind: 'params'; nodes: OpParamNode[] }).nodes.map(n => n.name);
        expect(names).toEqual(['x-request-id', 'authorization']);
    });

    it('preserves op-declared headers and prepends globals that do not collide', () => {
        const { root } = normalize(`
            options { request: { headers: { x-request-id: uuid } } }
            operation /widgets: {
                get: {
                    headers: { x-tenant: string }
                    response: { 200: { application/json: Widget } }
                }
            }
        `);
        const nodes = (root.routes[0]!.operations[0]!.headers as { nodes: OpParamNode[] }).nodes;
        expect(nodes.map(n => n.name)).toEqual(['x-request-id', 'x-tenant']);
    });

    it('op-level header with same name wins and emits an override warning', () => {
        const { root, diag } = normalize(`
            options { request: { headers: { x-request-id: uuid } } }
            operation /widgets: {
                get: {
                    headers: { x-request-id: string }
                    response: { 200: { application/json: Widget } }
                }
            }
        `);
        const nodes = (root.routes[0]!.operations[0]!.headers as { nodes: OpParamNode[] }).nodes;
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.type).toEqual({ kind: 'scalar', name: 'string' });
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes("overrides global request header"))).toBe(true);
    });

    it('skips merge entirely when op declares headers: none', () => {
        const { root } = normalize(`
            options { request: { headers: { x-request-id: uuid } } }
            operation /widgets: {
                get: {
                    headers: none
                    response: { 200: { application/json: Widget } }
                }
            }
        `);
        const op = root.routes[0]!.operations[0]!;
        expect(op.headers).toBeUndefined();
        expect(op.requestHeadersOptOut).toBe(true);
    });

    it('skips merge with a warning when op headers reference a type', () => {
        const { root, diag } = normalize(`
            options { request: { headers: { x-request-id: uuid } } }
            contract AuthHeaders: { authorization: string }
            operation /widgets: {
                get: {
                    headers: AuthHeaders
                    response: { 200: { application/json: Widget } }
                }
            }
        `);
        const op = root.routes[0]!.operations[0]!;
        expect(op.headers?.kind).toBe('ref');
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes('referenced headers type'))).toBe(true);
    });

    it('errors when a global request header collides with a path parameter', () => {
        const { diag } = normalize(`
            options { request: { headers: { id: string } } }
            operation /widgets/{id}: {
                params: { id: uuid }
                get: { response: { 200: { application/json: Widget } } }
            }
        `);
        const errors = diag.getAll().filter(d => d.severity === 'error');
        expect(errors.some(e => e.message.includes("collides with path parameter"))).toBe(true);
    });
});

describe('applyOptionsDefaults — response headers', () => {
    it('merges globals into every status code, including bodyless and 4xx/5xx', () => {
        const { root } = normalize(`
            options { response: { headers: { x-request-id: uuid } } }
            operation /widgets: {
                get: {
                    response: {
                        200: { application/json: Widget }
                        404:
                        500: { application/json: Error }
                    }
                }
            }
        `);
        const responses = root.routes[0]!.operations[0]!.responses;
        for (const r of responses) {
            const names = (r.headers ?? []).map(h => h.name);
            expect(names).toContain('x-request-id');
        }
    });

    it('merges globals into a 204 No Content response', () => {
        const { root } = normalize(`
            options { response: { headers: { x-request-id: uuid } } }
            operation /widgets/{id}: {
                params: { id: uuid }
                delete: {
                    response: { 204: }
                }
            }
        `);
        const r204 = root.routes[0]!.operations[0]!.responses.find(r => r.statusCode === 204)!;
        expect(r204.bodyType).toBeUndefined();
        expect((r204.headers ?? []).map(h => h.name)).toEqual(['x-request-id']);
    });

    it('per-status headers: none skips the merge for that code', () => {
        const { root } = normalize(`
            options { response: { headers: { x-request-id: uuid } } }
            operation /widgets: {
                get: {
                    response: {
                        200: { application/json: Widget }
                        404: { headers: none }
                    }
                }
            }
        `);
        const responses = root.routes[0]!.operations[0]!.responses;
        const r200 = responses.find(r => r.statusCode === 200)!;
        const r404 = responses.find(r => r.statusCode === 404)!;
        expect((r200.headers ?? []).map(h => h.name)).toContain('x-request-id');
        expect(r404.headers).toBeUndefined();
        expect(r404.headersOptOut).toBe(true);
    });

    it('per-status header with same name wins and is preserved', () => {
        const { root } = normalize(`
            options { response: { headers: { x-request-id: uuid } } }
            operation /widgets: {
                get: {
                    response: {
                        200: {
                            application/json: Widget
                            headers: { x-request-id: string }
                        }
                    }
                }
            }
        `);
        const r = root.routes[0]!.operations[0]!.responses[0]!;
        expect(r.headers).toHaveLength(1);
        expect(r.headers![0]!.type).toEqual({ kind: 'scalar', name: 'string' });
    });
});

describe('applyOptionsDefaults — no-op cases', () => {
    it('does nothing when neither globals nor op headers are declared', () => {
        const { root } = normalize(BASE_OP);
        const op = root.routes[0]!.operations[0]!;
        expect(op.headers).toBeUndefined();
        expect(op.responses.every(r => r.headers === undefined)).toBe(true);
    });

    it('preserves AST identity for ops with existing headers when there is nothing new to add', () => {
        const { root } = normalize(`
            options { request: { headers: { x-request-id: uuid } } }
            operation /widgets: {
                get: {
                    headers: { x-request-id: string }
                    response: { 200: { application/json: Widget } }
                }
            }
        `);
        const nodes = (root.routes[0]!.operations[0]!.headers as { nodes: OpParamNode[] }).nodes;
        expect(nodes).toHaveLength(1);
    });
});
