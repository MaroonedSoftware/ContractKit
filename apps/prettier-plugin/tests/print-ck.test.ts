import { describe, it, expect } from 'vitest';
import { printCk } from '../src/print-ck.js';
import { parseCk, DiagnosticCollector } from '@contractkit/core';
import type { OpRouteNode, OpOperationNode, CkRootNode, SecurityFields, ParamSource, ContractTypeNode, OpParamNode } from '@contractkit/core';

// ─── Minimal AST builders ────────────────────────────────────────────────────

function makeLoc(line = 1) {
    return { file: 'test.ck', line };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParamSource(value: any): ParamSource {
    if (!value) return value;
    if (typeof value === 'string') return { kind: 'ref', name: value };
    if (Array.isArray(value)) return { kind: 'params', nodes: value as OpParamNode[] };
    if (value.kind === 'params' || value.kind === 'ref' || value.kind === 'type') return value as ParamSource;
    return { kind: 'type', node: value as ContractTypeNode };
}

function makeOp(method: OpOperationNode['method'], overrides?: Partial<OpOperationNode> & { query?: unknown; headers?: unknown }): OpOperationNode {
    const normalized = { ...overrides } as Partial<OpOperationNode>;
    if (overrides?.query !== undefined) normalized.query = normalizeParamSource(overrides.query);
    if (overrides?.headers !== undefined) normalized.headers = normalizeParamSource(overrides.headers);
    return { method, responses: [], loc: makeLoc(), ...normalized };
}

function makeRoute(path: string, operations: OpOperationNode[], overrides?: Partial<OpRouteNode> & { params?: unknown }): OpRouteNode {
    const normalized = { ...overrides } as Partial<OpRouteNode>;
    if (overrides?.params !== undefined) normalized.params = normalizeParamSource(overrides.params);
    return { path, operations, loc: makeLoc(), ...normalized };
}

function makeRoot(routes: OpRouteNode[]): CkRootNode {
    return { kind: 'ckRoot', meta: {}, services: {}, models: [], routes, file: 'test.ck' };
}

// ─── Route modifier printing ─────────────────────────────────────────────────

describe('printCk — route modifiers', () => {
    it('prints route with no modifiers', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get')])]);
        expect(printCk(ast)).toContain('operation /users: {');
    });

    it('prints route with internal modifier', () => {
        const ast = makeRoot([makeRoute('/admin/users', [makeOp('get')], { modifiers: ['internal'] })]);
        expect(printCk(ast)).toContain('operation(internal) /admin/users: {');
    });

    it('prints route with deprecated modifier', () => {
        const ast = makeRoot([makeRoute('/v1/users', [makeOp('get')], { modifiers: ['deprecated'] })]);
        expect(printCk(ast)).toContain('operation(deprecated) /v1/users: {');
    });

    it('treats empty modifiers array same as no modifier', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get')], { modifiers: [] })]);
        expect(printCk(ast)).toContain('operation /users: {');
    });

    it('preserves description alongside modifier', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get')], { modifiers: ['deprecated'], description: 'Old user list' })]);
        expect(printCk(ast)).toContain('operation(deprecated) /users: { # Old user list');
    });
});

// ─── Operation modifier printing ─────────────────────────────────────────────

describe('printCk — operation modifiers', () => {
    it('prints operation with no modifiers', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get')])]);
        expect(printCk(ast)).toContain('    get: {');
    });

    it('prints operation with internal modifier', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get', { modifiers: ['internal'] })])]);
        expect(printCk(ast)).toContain('    get(internal): {');
    });

    it('prints operation with deprecated modifier', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get', { modifiers: ['deprecated'] })])]);
        expect(printCk(ast)).toContain('    get(deprecated): {');
    });

    it('treats empty operation modifiers array as no modifiers', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('delete', { modifiers: [] })])]);
        expect(printCk(ast)).toContain('    delete: {');
    });

    it('prints multiple operations with mixed modifiers', () => {
        const ast = makeRoot([
            makeRoute('/users', [makeOp('get', { modifiers: ['deprecated'] }), makeOp('post', { modifiers: ['internal'] }), makeOp('delete')]),
        ]);
        const output = printCk(ast);
        expect(output).toContain('    get(deprecated): {');
        expect(output).toContain('    post(internal): {');
        expect(output).toContain('    delete: {');
    });

    it('preserves description alongside modifier on operation', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get', { modifiers: ['internal'], description: 'Admin only' })])]);
        expect(printCk(ast)).toContain('    get(internal): { # Admin only');
    });
});

// ─── Route + operation modifier combinations ──────────────────────────────────

describe('printCk — route and operation modifiers combined', () => {
    it('prints both route and operation modifiers independently', () => {
        const ast = makeRoot([
            makeRoute('/admin/users', [makeOp('get', { modifiers: ['deprecated'] }), makeOp('post', { modifiers: ['internal'] })], {
                modifiers: ['internal'],
            }),
        ]);
        const output = printCk(ast);
        expect(output).toContain('operation(internal) /admin/users: {');
        expect(output).toContain('    get(deprecated): {');
        expect(output).toContain('    post(internal): {');
    });

    it('modifier placement: operation(modifier) before path, verb(modifier) before colon', () => {
        const ast = makeRoot([makeRoute('/admin', [makeOp('get', { modifiers: ['deprecated'] })], { modifiers: ['internal'] })]);
        const output = printCk(ast);
        expect(output).toMatch(/^operation\(internal\) \/admin: \{/m);
        expect(output).toMatch(/^\s+get\(deprecated\): \{/m);
    });
});

// ─── Security printing ────────────────────────────────────────────────────────

function makeSecFields(fields: Partial<Pick<SecurityFields, 'roles'>>): SecurityFields {
    return { ...fields, loc: makeLoc() };
}

describe('printCk — security', () => {
    it('prints operation-level security: none', () => {
        const ast = makeRoot([makeRoute('/health', [makeOp('get', { security: 'none' })])]);
        expect(printCk(ast)).toContain('        security: none');
    });

    it('prints security block with roles only', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get', { security: makeSecFields({ roles: ['admin'] }) })])]);
        const out = printCk(ast);
        expect(out).toContain('        security: {');
        expect(out).toContain('            roles: admin');
        expect(out).toContain('        }');
    });

    it('prints security block with multiple roles space-separated', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get', { security: makeSecFields({ roles: ['admin', 'moderator'] }) })])]);
        expect(printCk(ast)).toContain('            roles: admin moderator');
    });

    it('prints operation-level signature as its own keyword', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('post', { signature: 'hmac-sha256' })])]);
        const out = printCk(ast);
        expect(out).toContain('        signature: "hmac-sha256"');
        expect(out).not.toContain('security: {');
    });

    it('prints unquoted identifier signature without quotes', () => {
        const ast = makeRoot([makeRoute('/webhooks', [makeOp('post', { signature: 'MODERN_TREASURY_WEBHOOK' })])]);
        expect(printCk(ast)).toContain('        signature: MODERN_TREASURY_WEBHOOK');
    });

    it('prints route-level security with shallower indentation', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get')], { security: makeSecFields({ roles: ['admin'] }) })]);
        const out = printCk(ast);
        expect(out).toContain('    security: {');
        expect(out).toContain('        roles: admin');
    });

    it('prints route-level security: none', () => {
        const ast = makeRoot([makeRoute('/public', [makeOp('get')], { security: 'none' })]);
        expect(printCk(ast)).toContain('    security: none');
    });

    it('emits no security line when security is undefined', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get')])]);
        expect(printCk(ast)).not.toContain('security');
    });
});

// ─── plugins block printing ───────────────────────────────────────────────────

describe('printCk — plugins block', () => {
    it('prints plugins block with single entry', () => {
        const ast = makeRoot([makeRoute('/auth/token', [makeOp('post', { plugins: { bruno: 'request-token.yml' } })])]);
        const out = printCk(ast);
        expect(out).toContain('        plugins: {');
        expect(out).toContain('            bruno: "request-token.yml"');
        expect(out).toContain('        }');
    });

    it('prints plugins block with multiple entries', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('post', { plugins: { bruno: 'create-user.yml', typescript: 'stub.ts' } })])]);
        const out = printCk(ast);
        expect(out).toContain('            bruno: "create-user.yml"');
        expect(out).toContain('            typescript: "stub.ts"');
    });

    it('omits plugins block when plugins is undefined', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get')])]);
        expect(printCk(ast)).not.toContain('plugins');
    });

    it('omits plugins block when plugins is empty object', () => {
        const ast = makeRoot([makeRoute('/users', [makeOp('get', { plugins: {} })])]);
        expect(printCk(ast)).not.toContain('plugins');
    });

    it('plugins block round-trips via parse', () => {
        const src = `operation /auth/token: {
    post: {
        plugins: {
            bruno: "request-token.yml"
        }
    }
}
`;
        const diag = new DiagnosticCollector();
        const ast = parseCk(src, 'test.ck', diag);
        expect(diag.hasErrors()).toBe(false);
        const out = printCk(ast);
        expect(out).toContain('            bruno: "request-token.yml"');
    });
});

// ─── Query / headers with descriptions ───────────────────────────────────────

describe('printCk — query and headers descriptions', () => {
    it('emits inline comment on query params that have descriptions', () => {
        const loc = makeLoc();
        const ast = makeRoot([
            makeRoute('/users', [
                makeOp('get', {
                    query: [
                        { name: 'page', optional: false, nullable: false, type: { kind: 'scalar', name: 'int' }, description: 'Page number', loc },
                        { name: 'limit', optional: false, nullable: false, type: { kind: 'scalar', name: 'int' }, loc },
                    ],
                }),
            ]),
        ]);
        const out = printCk(ast);
        expect(out).toContain('            page: int # Page number');
        expect(out).toContain('            limit: int');
        expect(out).not.toMatch(/limit: int #/);
    });

    it('emits inline comment on headers params that have descriptions', () => {
        const loc = makeLoc();
        const ast = makeRoot([
            makeRoute('/users', [
                makeOp('get', {
                    headers: [
                        {
                            name: 'X-Request-Id',
                            optional: false,
                            nullable: false,
                            type: { kind: 'scalar', name: 'uuid' },
                            description: 'Idempotency key',
                            loc,
                        },
                    ],
                }),
            ]),
        ]);
        expect(printCk(ast)).toContain('            X-Request-Id: uuid # Idempotency key');
    });
});

// ─── Query / headers — optional, nullable, defaults ──────────────────────────

describe('printCk — query and headers optional, nullable, default', () => {
    const loc = makeLoc();

    it('emits ? for optional query params', () => {
        const ast = makeRoot([
            makeRoute('/search', [
                makeOp('get', {
                    query: [
                        { name: 'q', optional: true, nullable: false, type: { kind: 'scalar', name: 'string' }, loc },
                        { name: 'page', optional: false, nullable: false, type: { kind: 'scalar', name: 'int' }, loc },
                    ],
                }),
            ]),
        ]);
        const out = printCk(ast);
        expect(out).toContain('            q?: string');
        expect(out).toContain('            page: int');
        expect(out).not.toContain('page?:');
    });

    it('emits | null for nullable query params', () => {
        const ast = makeRoot([
            makeRoute('/items', [
                makeOp('get', {
                    query: [{ name: 'filter', optional: false, nullable: true, type: { kind: 'scalar', name: 'string' }, loc }],
                }),
            ]),
        ]);
        expect(printCk(ast)).toContain('            filter: string | null');
    });

    it('emits = value for numeric defaults', () => {
        const ast = makeRoot([
            makeRoute('/items', [
                makeOp('get', {
                    query: [{ name: 'limit', optional: false, nullable: false, type: { kind: 'scalar', name: 'int' }, default: 20, loc }],
                }),
            ]),
        ]);
        expect(printCk(ast)).toContain('            limit: int = 20');
    });

    it('emits = value for boolean defaults', () => {
        const ast = makeRoot([
            makeRoute('/items', [
                makeOp('get', {
                    query: [{ name: 'active', optional: false, nullable: false, type: { kind: 'scalar', name: 'boolean' }, default: true, loc }],
                }),
            ]),
        ]);
        expect(printCk(ast)).toContain('            active: boolean = true');
    });

    it('emits = "value" for string defaults that need quoting', () => {
        const ast = makeRoot([
            makeRoute('/items', [
                makeOp('get', {
                    query: [
                        { name: 'label', optional: false, nullable: false, type: { kind: 'scalar', name: 'string' }, default: 'hello world', loc },
                    ],
                }),
            ]),
        ]);
        expect(printCk(ast)).toContain('            label: string = "hello world"');
    });

    it('combines optional, default, and description on the same param', () => {
        const ast = makeRoot([
            makeRoute('/items', [
                makeOp('get', {
                    query: [
                        {
                            name: 'page',
                            optional: true,
                            nullable: false,
                            type: { kind: 'scalar', name: 'int' },
                            default: 1,
                            description: 'Page number',
                            loc,
                        },
                    ],
                }),
            ]),
        ]);
        expect(printCk(ast)).toContain('            page?: int = 1 # Page number');
    });

    it('applies the same rules to headers params', () => {
        const ast = makeRoot([
            makeRoute('/items', [
                makeOp('get', {
                    headers: [{ name: 'X-Version', optional: true, nullable: false, type: { kind: 'scalar', name: 'string' }, default: 'v1', loc }],
                }),
            ]),
        ]);
        expect(printCk(ast)).toContain('            X-Version?: string = v1');
    });
});

// ─── Request blocks ──────────────────────────────────────────────────────────

describe('printCk — request blocks', () => {
    it('prints a single content-type request', () => {
        const ast = makeRoot([
            makeRoute('/users', [
                makeOp('post', {
                    request: { bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'CreateUser' } }] },
                }),
            ]),
        ]);
        const out = printCk(ast);
        expect(out).toContain('        request: {');
        expect(out).toContain('            application/json: CreateUser');
    });

    it('round-trips vendor JSON mime types like application/vnd.api+json', () => {
        const ast = makeRoot([
            makeRoute('/users', [
                makeOp('post', {
                    request: { bodies: [{ contentType: 'application/vnd.api+json', bodyType: { kind: 'ref', name: 'CreateUser' } }] },
                    responses: [{ statusCode: 201, contentType: 'application/vnd.api+json', bodyType: { kind: 'ref', name: 'User' } }],
                }),
            ]),
        ]);
        const out = printCk(ast);
        expect(out).toContain('            application/vnd.api+json: CreateUser');
        expect(out).toContain('                application/vnd.api+json: User');
    });

    it('prints multiple content-types preserving source order', () => {
        const ast = makeRoot([
            makeRoute('/auth/token', [
                makeOp('post', {
                    request: {
                        bodies: [
                            { contentType: 'application/json', bodyType: { kind: 'ref', name: 'AuthRequest' } },
                            { contentType: 'application/x-www-form-urlencoded', bodyType: { kind: 'ref', name: 'AuthRequest' } },
                        ],
                    },
                }),
            ]),
        ]);
        const out = printCk(ast);
        expect(out).toContain('            application/json: AuthRequest');
        expect(out).toContain('            application/x-www-form-urlencoded: AuthRequest');
        // Order check
        const i1 = out.indexOf('application/json:');
        const i2 = out.indexOf('application/x-www-form-urlencoded:');
        expect(i1).toBeLessThan(i2);
    });
});

describe('printCk — response headers', () => {
    it('prints response headers alongside body', () => {
        const ast = makeRoot([
            makeRoute('/transfers/{id}', [
                makeOp('get', {
                    responses: [
                        {
                            statusCode: 200,
                            contentType: 'application/json',
                            bodyType: { kind: 'ref', name: 'Transfer' },
                            headers: [
                                { name: 'preference-applied', optional: true, type: { kind: 'scalar', name: 'string' } },
                                { name: 'etag', optional: false, type: { kind: 'scalar', name: 'string' }, description: 'cache validator' },
                            ],
                        },
                    ],
                }),
            ]),
        ]);
        const out = printCk(ast);
        expect(out).toContain('            200: {');
        expect(out).toContain('                application/json: Transfer');
        expect(out).toContain('                headers: {');
        expect(out).toContain('                    preference-applied?: string');
        expect(out).toContain('                    etag: string # cache validator');
    });

    it('prints response headers without a body', () => {
        const ast = makeRoot([
            makeRoute('/resources/{id}', [
                makeOp('delete', {
                    responses: [
                        {
                            statusCode: 204,
                            headers: [{ name: 'x-deleted-at', optional: false, type: { kind: 'scalar', name: 'string' } }],
                        },
                    ],
                }),
            ]),
        ]);
        const out = printCk(ast);
        expect(out).toContain('            204: {');
        expect(out).toContain('                headers: {');
        expect(out).toContain('                    x-deleted-at: string');
        expect(out).not.toContain('application/json');
    });
});

describe('printCk — options-level header globals (round-trip)', () => {
    function roundTrip(source: string): string {
        const diag = new DiagnosticCollector();
        const ast = parseCk(source, 'test.ck', diag);
        expect(diag.hasErrors()).toBe(false);
        return printCk(ast);
    }

    it('round-trips options.request.headers', () => {
        const source = `\
options {
    request: {
        headers: {
            x-request-id: uuid
            authorization?: string
        }
    }
}

operation /widgets: {
    get: {
        response: {
            200: {
                application/json: Widget
            }
        }
    }
}
`;
        const out = roundTrip(source);
        expect(out).toBe(source);
    });

    it('round-trips options.response.headers', () => {
        const source = `\
options {
    response: {
        headers: {
            x-request-id: uuid
        }
    }
}

operation /widgets: {
    get: {
        response: {
            200: {
                application/json: Widget
            }
        }
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('round-trips operation-level headers: none', () => {
        const source = `\
operation /widgets: {
    get: {
        headers: none
        response: {
            200: {
                application/json: Widget
            }
        }
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('round-trips per-status headers: none', () => {
        const source = `\
operation /widgets: {
    get: {
        response: {
            200: {
                application/json: Widget
            }
            404: {
                headers: none
            }
        }
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });
});

describe('printCk — multi-base inheritance and override (round-trip)', () => {
    function roundTrip(source: string): string {
        const diag = new DiagnosticCollector();
        const ast = parseCk(source, 'test.ck', diag);
        expect(diag.hasErrors()).toBe(false);
        return printCk(ast);
    }

    it('round-trips multi-base inheritance', () => {
        const source = `\
contract Test5: A & B & C & D & {
    e: string
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('round-trips override modifier on a field', () => {
        const source = `\
contract Test5: A & {
    a: override int
    e: string
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('emits canonical modifier order: override → deprecated → readonly', () => {
        const source = `\
contract Test: A & {
    a: deprecated override readonly string
}
`;
        // Canonical order is override → deprecated → readonly|writeonly.
        // Re-printing reorders the modifiers.
        const printed = roundTrip(source);
        expect(printed).toContain('a: override deprecated readonly string');
    });
});

describe('printCk — typed path params (round-trip)', () => {
    function roundTrip(source: string): string {
        const diag = new DiagnosticCollector();
        const ast = parseCk(source, 'test.ck', diag);
        expect(diag.hasErrors()).toBe(false);
        return printCk(ast);
    }

    it('round-trips path params with constraint arguments', () => {
        const source = `\
operation /orders/{orderId}: {
    params: {
        orderId: int(min=1, max=5)
    }
    get: {
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('round-trips path params with enum types', () => {
        const source = `\
operation /pets/{status}: {
    params: {
        status: enum(available, pending, sold)
    }
    get: {
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('round-trips path params with regex constraints and a comment', () => {
        const source = `\
operation /users/{slug}: {
    params: {
        slug: string(regex=/^[a-z0-9-]+$/) # url slug
    }
    get: {
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });
});

describe('printCk — options keys and services quoting', () => {
    function roundTrip(source: string): string {
        const diag = new DiagnosticCollector();
        const ast = parseCk(source, 'test.ck', diag);
        expect(diag.hasErrors()).toBe(false);
        return printCk(ast);
    }

    it('leaves simple identifier keys values unquoted', () => {
        const source = `\
options {
    keys: {
        area: payments
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('preserves quotes on path-like values containing slashes', () => {
        const source = `\
options {
    keys: {
        bruno: "../../bruno/"
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('quotes values that start with a dot', () => {
        const source = `\
options {
    keys: {
        path: "../relative"
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('preserves quotes on service paths starting with #', () => {
        const source = `\
options {
    services: {
        AuthService: "#src/modules/auth/auth.service.js"
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });

    it('leaves plain identifier service names unquoted', () => {
        const source = `\
options {
    services: {
        AuthService: authService
    }
}
`;
        expect(roundTrip(source)).toBe(source);
    });
});
