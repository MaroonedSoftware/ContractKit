import { parseOp } from '../src/parser-op.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import type { ScalarTypeNode } from '../src/ast.js';
import { resolveModifiers, resolveSecurity, SECURITY_NONE } from '../src/ast.js';

function parse(source: string) {
  const diag = new DiagnosticCollector();
  const root = parseOp(source, 'test.op', diag);
  return { root, diag };
}

describe('parseOp', () => {
  // ─── Route paths ────────────────────────────────────────────────

  describe('route paths', () => {
    it('parses simple route path', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes).toHaveLength(1);
      expect(root.routes[0]!.path).toBe('/users');
    });

    it('parses route with path parameters', () => {
      const { root } = parse('/users/:id { get: {} }');
      expect(root.routes[0]!.path).toBe('/users/:id');
    });

    it('parses nested route path', () => {
      const { root } = parse('/api/v1/users { get: {} }');
      expect(root.routes[0]!.path).toBe('/api/v1/users');
    });

    it('parses route with multiple path parameters', () => {
      const { root } = parse('/users/:userId/posts/:postId { get: {} }');
      expect(root.routes[0]!.path).toBe('/users/:userId/posts/:postId');
    });

    it('errors on route not starting with slash', () => {
      const { diag } = parse('users { get: {} }');
      expect(diag.hasErrors()).toBe(true);
    });
  });

  // ─── Params block ──────────────────────────────────────────────

  describe('params block', () => {
    it('parses params with scalar types', () => {
      const { root } = parse(`\
/users/:id {
    params: {
        id: uuid
    }
    get: {}
}`);
      const params = root.routes[0]!.params;
      expect(params).toHaveLength(1);
      expect(params![0]!.name).toBe('id');
      expect(params![0]!.type).toMatchObject({ kind: 'scalar', name: 'uuid' });
    });

    it('parses multiple params', () => {
      const { root } = parse(`\
/users/:id/posts/:postId {
    params: {
        id: uuid
        postId: uuid
    }
    get: {}
}`);
      const params = root.routes[0]!.params;
      expect(params).toHaveLength(2);
      expect(params![0]!.name).toBe('id');
      expect(params![1]!.name).toBe('postId');
    });

    it('parses params as type reference declaration', () => {
      const { root } = parse(`\
/users/:id {
    params: RouteParams
    get: {}
}`);
      expect(root.routes[0]!.params).toBe('RouteParams');
    });
  });

  // ─── HTTP methods ──────────────────────────────────────────────

  describe('HTTP methods', () => {
    it('parses GET operation', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes[0]!.operations[0]!.method).toBe('get');
    });

    it('parses POST operation', () => {
      const { root } = parse('/users { post: {} }');
      expect(root.routes[0]!.operations[0]!.method).toBe('post');
    });

    it('parses PUT operation', () => {
      const { root } = parse('/users { put: {} }');
      expect(root.routes[0]!.operations[0]!.method).toBe('put');
    });

    it('parses PATCH operation', () => {
      const { root } = parse('/users { patch: {} }');
      expect(root.routes[0]!.operations[0]!.method).toBe('patch');
    });

    it('parses DELETE operation', () => {
      const { root } = parse('/users { delete: {} }');
      expect(root.routes[0]!.operations[0]!.method).toBe('delete');
    });

    it('parses operation with empty body', () => {
      const { root } = parse('/users { delete: {} }');
      const op = root.routes[0]!.operations[0]!;
      expect(op.method).toBe('delete');
      expect(op.request).toBeUndefined();
      expect(op.responses).toHaveLength(0);
    });
  });

  // ─── Request block ─────────────────────────────────────────────

  describe('request block', () => {
    it('parses JSON request with body type', () => {
      const { root } = parse(`\
/users {
    post: {
        request: {
            application/json: CreateUserInput
        }
    }
}`);
      const request = root.routes[0]!.operations[0]!.request;
      expect(request).toBeDefined();
      expect(request!.contentType).toBe('application/json');
      expect(request!.bodyType).toEqual({ kind: 'ref', name: 'CreateUserInput' });
    });

    it('parses multipart request', () => {
      const { root } = parse(`\
/uploads {
    post: {
        request: {
            multipart/form-data: UploadInput
        }
    }
}`);
      const request = root.routes[0]!.operations[0]!.request;
      expect(request!.contentType).toBe('multipart/form-data');
    });
  });

  // ─── Response block ────────────────────────────────────────────

  describe('response block', () => {
    it('parses response with status code and body type', () => {
      const { root } = parse(`\
/users {
    get: {
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}`);
      const responses = root.routes[0]!.operations[0]!.responses;
      expect(responses).toHaveLength(1);
      expect(responses[0]!.statusCode).toBe(200);
      expect(responses[0]!.contentType).toBe('application/json');
      expect(responses[0]!.bodyType).toEqual({ kind: 'array', item: { kind: 'ref', name: 'User' } });
    });

    it('parses response with no body', () => {
      const { root } = parse(`\
/users/:id {
    delete: {
        response: {
            204:
        }
    }
}`);
      const responses = root.routes[0]!.operations[0]!.responses;
      expect(responses).toHaveLength(1);
      expect(responses[0]!.statusCode).toBe(204);
      expect(responses[0]!.bodyType).toBeUndefined();
    });
  });

  // ─── Query block ─────────────────────────────────────────────

  describe('query block', () => {
    it('parses query with typed parameters', () => {
      const { root } = parse(`\
/users {
    get: {
        query: {
            page: int
            limit: int
        }
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.query).toHaveLength(2);
      expect(op.query![0]!.name).toBe('page');
      expect(op.query![0]!.type).toMatchObject({ kind: 'scalar', name: 'int' });
      expect(op.query![1]!.name).toBe('limit');
    });

    it('parses query as type reference declaration', () => {
      const { root } = parse(`\
/users {
    get: {
        query: Pagination
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.query).toBe('Pagination');
    });

    it('leaves query undefined when not declared', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes[0]!.operations[0]!.query).toBeUndefined();
    });
  });

  // ─── Headers block ──────────────────────────────────────────

  describe('headers block', () => {
    it('parses headers with typed parameters', () => {
      const { root } = parse(`\
/users {
    get: {
        headers: {
            authorization: string
            x-request-id: uuid
        }
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.headers).toHaveLength(2);
      expect(op.headers![0]!.name).toBe('authorization');
      expect(op.headers![0]!.type).toMatchObject({ kind: 'scalar', name: 'string' });
      expect(op.headers![1]!.name).toBe('x-request-id');
      expect(op.headers![1]!.type).toMatchObject({ kind: 'scalar', name: 'uuid' });
    });

    it('parses headers as type reference declaration', () => {
      const { root } = parse(`\
/users {
    get: {
        headers: CommonHeaders
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.headers).toBe('CommonHeaders');
    });

    it('leaves headers undefined when not declared', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes[0]!.operations[0]!.headers).toBeUndefined();
    });

    it('parses strict mode prefix on headers block', () => {
      const { root } = parse(`\
/users {
    get: {
        strict headers: {
            authorization: string
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.headersMode).toBe('strict');
      expect(op.headers).toHaveLength(1);
    });

    it('parses strip mode prefix on headers block', () => {
      const { root } = parse(`\
/users {
    get: {
        strip headers: {
            authorization: string
        }
    }
}`);
      expect(root.routes[0]!.operations[0]!.headersMode).toBe('strip');
    });

    it('defaults headersMode to undefined when no prefix', () => {
      const { root } = parse(`\
/users {
    get: {
        headers: {
            authorization: string
        }
    }
}`);
      expect(root.routes[0]!.operations[0]!.headersMode).toBeUndefined();
    });
  });

  // ─── Service declaration ─────────────────────────────────────

  describe('service declaration', () => {
    it('parses service with class and method', () => {
      const { root } = parse(`\
/users/:id {
    put: {
        service: LedgerService.updateUser
        response: {
            200: {
                application/json: User
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.service).toBe('LedgerService.updateUser');
    });

    it('parses service with class only', () => {
      const { root } = parse(`\
/transfers {
    post: {
        service: TransfersService
        request: {
            application/json: CreateTransferIntent
        }
        response: {
            201: {
                application/json: TransferIntent
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.service).toBe('TransfersService');
    });

    it('leaves service undefined when not declared', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes[0]!.operations[0]!.service).toBeUndefined();
    });
  });

  // ─── SDK declaration ─────────────────────────────────────────

  describe('sdk declaration', () => {
    it('parses sdk method name', () => {
      const { root } = parse(`\
/users {
    get: {
        sdk: listUsers
        response: {
            200: {
                application/json: User
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.sdk).toBe('listUsers');
    });

    it('parses sdk alongside service', () => {
      const { root } = parse(`\
/users/:id {
    get: {
        service: UserService.getById
        sdk: getUser
        response: {
            200: {
                application/json: User
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.service).toBe('UserService.getById');
      expect(op.sdk).toBe('getUser');
    });

    it('leaves sdk undefined when not declared', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes[0]!.operations[0]!.sdk).toBeUndefined();
    });
  });

  // ─── Multiple operations / routes ──────────────────────────────

  describe('multiple operations and routes', () => {
    it('parses multiple HTTP methods under one route', () => {
      const { root } = parse(`\
/users {
    get: {}
    post: {}
}`);
      expect(root.routes[0]!.operations).toHaveLength(2);
      expect(root.routes[0]!.operations[0]!.method).toBe('get');
      expect(root.routes[0]!.operations[1]!.method).toBe('post');
    });

    it('parses multiple routes', () => {
      const { root } = parse(`\
/users {
    get: {}
}

/posts {
    get: {}
}`);
      expect(root.routes).toHaveLength(2);
      expect(root.routes[0]!.path).toBe('/users');
      expect(root.routes[1]!.path).toBe('/posts');
    });
  });

  // ─── Error recovery ────────────────────────────────────────────

  describe('error recovery', () => {
    it('collects errors and continues parsing', () => {
      const { root, diag } = parse(`\
bad-route-no-slash {
    get: {}
}

/valid {
    get: {}
}`);
      expect(diag.hasErrors()).toBe(true);
    });
  });

  // ─── Full example ──────────────────────────────────────────────

  describe('full example', () => {
    it('parses a complete route with params, request, and response', () => {
      const { root, diag } = parse(`\
/users/:id {
    params: {
        id: uuid
    }
    get: {
        response: {
            200: {
                application/json: User
            }
        }
    }
    put: {
        request: {
            application/json: UpdateUserInput
        }
        response: {
            200: {
                application/json: User
            }
        }
    }
}`);
      expect(diag.hasErrors()).toBe(false);
      const route = root.routes[0]!;
      expect(route.path).toBe('/users/:id');
      expect(route.params).toHaveLength(1);
      expect(route.operations).toHaveLength(2);

      const getOp = route.operations[0]!;
      expect(getOp.method).toBe('get');
      expect(getOp.responses[0]!.statusCode).toBe(200);
      expect(getOp.responses[0]!.bodyType).toEqual({ kind: 'ref', name: 'User' });

      const putOp = route.operations[1]!;
      expect(putOp.method).toBe('put');
      expect(putOp.request!.bodyType).toEqual({ kind: 'ref', name: 'UpdateUserInput' });
      expect(putOp.responses[0]!.bodyType).toEqual({ kind: 'ref', name: 'User' });
    });
  });

  // ─── Comment descriptions ──────────────────────────────────────

  describe('comment descriptions', () => {
    it('parses route description from preceding comment', () => {
      const { root } = parse(`\
# User management routes
/users {
    get: {}
}`);
      expect(root.routes[0]!.description).toBe('User management routes');
    });

    it('parses operation description from preceding comment', () => {
      const { root } = parse(`\
/users {
    # List all users
    get: {}
}`);
      expect(root.routes[0]!.operations[0]!.description).toBe('List all users');
    });

    it('returns undefined description when no comment present', () => {
      const { root } = parse(`\
/users {
    get: {}
}`);
      expect(root.routes[0]!.description).toBeUndefined();
      expect(root.routes[0]!.operations[0]!.description).toBeUndefined();
    });
  });

  // ─── Front-matter ────────────────────────────────────────────────

  describe('front-matter', () => {
    it('parses front-matter with unquoted value', () => {
      const { root } = parse(`\
---
module: capital
---
/capital { get: {} }`);
      expect(root.meta).toEqual({ module: 'capital' });
      expect(root.routes).toHaveLength(1);
    });

    it('parses front-matter with quoted string value', () => {
      const { root } = parse(`\
---
CapitalService: "#modules/capital/capital.service.js"
---
/capital { get: {} }`);
      expect(root.meta).toEqual({ CapitalService: '#modules/capital/capital.service.js' });
    });

    it('parses front-matter with unquoted hash-prefixed path', () => {
      const { root } = parse(`\
---
CapitalService: #modules/capital/capital.service.js
---
/capital { get: {} }`);
      expect(root.meta).toEqual({ CapitalService: '#modules/capital/capital.service.js' });
    });

    it('parses front-matter with multiple entries', () => {
      const { root } = parse(`\
---
CapitalService: #modules/capital/capital.service.js
LedgerService: #modules/ledger/ledger.service.js
---
/capital { get: {} }`);
      expect(root.meta).toEqual({
        CapitalService: '#modules/capital/capital.service.js',
        LedgerService: '#modules/ledger/ledger.service.js',
      });
    });

    it('defaults to empty meta when no front-matter', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.meta).toEqual({});
    });
  });

  // ─── Route modifiers ───────────────────────────────────────────

  describe('route modifiers', () => {
    it('parses single internal modifier on route', () => {
      const { root } = parse('/admin/users: internal { get: {} }');
      expect(root.routes[0]!.modifiers).toEqual(['internal']);
    });

    it('parses deprecated modifier on route', () => {
      const { root } = parse('/old/users: deprecated { get: {} }');
      expect(root.routes[0]!.modifiers).toEqual(['deprecated']);
    });

    it('parses multiple modifiers on route', () => {
      const { root } = parse('/admin/users: internal deprecated { get: {} }');
      expect(root.routes[0]!.modifiers).toEqual(['internal', 'deprecated']);
    });

    it('route without modifier has undefined modifiers', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes[0]!.modifiers).toBeUndefined();
    });

    it('parses internal modifier on operation', () => {
      const { root } = parse('/users { post: internal { } }');
      expect(root.routes[0]!.operations[0]!.modifiers).toEqual(['internal']);
    });

    it('parses deprecated modifier on operation', () => {
      const { root } = parse('/users { get: deprecated { } }');
      expect(root.routes[0]!.operations[0]!.modifiers).toEqual(['deprecated']);
    });

    it('parses multiple modifiers on operation', () => {
      const { root } = parse('/users { get: internal deprecated { } }');
      expect(root.routes[0]!.operations[0]!.modifiers).toEqual(['internal', 'deprecated']);
    });

    it('operation without modifier has undefined modifiers', () => {
      const { root } = parse('/users { get: {} }');
      expect(root.routes[0]!.operations[0]!.modifiers).toBeUndefined();
    });

    it('operation modifier overrides route modifier', () => {
      const { root } = parse('/admin: internal { get: deprecated {} }');
      const route = root.routes[0]!;
      expect(route.modifiers).toEqual(['internal']);
      expect(route.operations[0]!.modifiers).toEqual(['deprecated']);
    });

    it('operation without modifier inherits route modifier', () => {
      const { root } = parse('/admin: internal { get: {} post: deprecated {} }');
      const route = root.routes[0]!;
      expect(route.modifiers).toEqual(['internal']);
      expect(route.operations[0]!.modifiers).toBeUndefined();  // inherits via resolveModifiers
      expect(route.operations[1]!.modifiers).toEqual(['deprecated']); // overrides
    });

    it('public modifier on operation is stored in AST for round-trip fidelity', () => {
      const { root } = parse('/admin: internal { get: public {} }');
      const route = root.routes[0]!;
      expect(route.modifiers).toEqual(['internal']);
      expect(route.operations[0]!.modifiers).toEqual(['public']);
    });

    it('public modifier strips inherited internal via resolveModifiers', () => {
      const { root } = parse('/admin: internal { get: public {} }');
      const route = root.routes[0]!;
      const op = route.operations[0]!;
      expect(resolveModifiers(route, op)).toEqual([]);
    });

    it('public combined with deprecated: AST keeps both, resolveModifiers strips public', () => {
      const { root } = parse('/admin: internal { get: public deprecated {} }');
      const route = root.routes[0]!;
      const op = route.operations[0]!;
      expect(op.modifiers).toEqual(['public', 'deprecated']);
      expect(resolveModifiers(route, op)).toEqual(['deprecated']);
    });
  });

  // ─── Security ───────────────────────────────────────────────────

  describe('security', () => {
    it('parses security: none as SECURITY_NONE on operation', () => {
      const { root } = parse('/users { get: { security: none } }');
      expect(root.routes[0]!.operations[0]!.security).toBe(SECURITY_NONE);
    });

    it('parses security: { roles: admin } with single role', () => {
      const { root } = parse('/users { get: { security: { roles: admin } } }');
      const sec = root.routes[0]!.operations[0]!.security as any;
      expect(sec.roles).toEqual(['admin']);
    });

    it('parses security: { roles: admin moderator } with multiple roles', () => {
      const { root } = parse('/users { get: { security: { roles: admin moderator editor } } }');
      const sec = root.routes[0]!.operations[0]!.security as any;
      expect(sec.roles).toEqual(['admin', 'moderator', 'editor']);
    });

    it('parses signature: "key" as a top-level operation field', () => {
      const { root } = parse('/users { post: { signature: "hmac-sha256" } }');
      const op = root.routes[0]!.operations[0]!;
      expect(op.signature).toBe('hmac-sha256');
      expect(op.security).toBeUndefined();
    });

    it('parses signature: UNQUOTED_KEY with unquoted identifier', () => {
      const { root } = parse('/users { post: { signature: MODERN_TREASURY_WEBHOOK } }');
      const op = root.routes[0]!.operations[0]!;
      expect(op.signature).toBe('MODERN_TREASURY_WEBHOOK');
    });

    it('parses signature: alongside security: { roles }', () => {
      const { root } = parse('/users { post: { signature: "hmac-sha256" security: { roles: admin } } }');
      const op = root.routes[0]!.operations[0]!;
      expect(op.signature).toBe('hmac-sha256');
      expect((op.security as any).roles).toEqual(['admin']);
    });

    it('parses signature: before or after security:', () => {
      const { root } = parse('/users { post: { security: { roles: admin } signature: MODERN_TREASURY_WEBHOOK } }');
      const op = root.routes[0]!.operations[0]!;
      expect(op.signature).toBe('MODERN_TREASURY_WEBHOOK');
      expect((op.security as any).roles).toEqual(['admin']);
    });

    it('parses route-level security: { roles: admin }', () => {
      const { root } = parse('/users { security: { roles: admin } get: {} }');
      const sec = root.routes[0]!.security as any;
      expect(sec.roles).toEqual(['admin']);
    });

    it('resolveSecurity: op-level wins over route-level', () => {
      const { root } = parse('/users { security: { roles: admin } get: { security: none } }');
      const route = root.routes[0]!;
      const op = route.operations[0]!;
      expect(resolveSecurity(route, op)).toBe(SECURITY_NONE);
    });

    it('resolveSecurity: falls back to route-level when op has no security', () => {
      const { root } = parse('/users { security: { roles: admin } get: {} }');
      const route = root.routes[0]!;
      const op = route.operations[0]!;
      const sec = resolveSecurity(route, op) as any;
      expect(sec.roles).toEqual(['admin']);
    });

    it('security: { ... } does not break subsequent fields', () => {
      const { root } = parse('/users { get: { security: { roles: admin } response: { 200: } } }');
      const op = root.routes[0]!.operations[0]!;
      expect((op.security as any).roles).toEqual(['admin']);
      expect(op.responses).toHaveLength(1);
      expect(op.responses[0]!.statusCode).toBe(200);
    });
  });
});
