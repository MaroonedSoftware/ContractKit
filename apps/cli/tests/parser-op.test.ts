import { parseOp } from '../src/parser-op.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import type { ScalarTypeNode } from '../src/ast.js';

function parse(source: string) {
  const diag = new DiagnosticCollector();
  const root = parseOp(source, 'test.op', diag);
  return { root, diag };
}

describe('parseOp', () => {
  // ─── Route paths ────────────────────────────────────────────────

  describe('route paths', () => {
    it('parses simple route path', () => {
      const { root } = parse('/users { get }');
      expect(root.routes).toHaveLength(1);
      expect(root.routes[0]!.path).toBe('/users');
    });

    it('parses route with path parameters', () => {
      const { root } = parse('/users/:id { get }');
      expect(root.routes[0]!.path).toBe('/users/:id');
    });

    it('parses nested route path', () => {
      const { root } = parse('/api/v1/users { get }');
      expect(root.routes[0]!.path).toBe('/api/v1/users');
    });

    it('parses route with multiple path parameters', () => {
      const { root } = parse('/users/:userId/posts/:postId { get }');
      expect(root.routes[0]!.path).toBe('/users/:userId/posts/:postId');
    });

    it('errors on route not starting with slash', () => {
      const { diag } = parse('users { get }');
      expect(diag.hasErrors()).toBe(true);
    });
  });

  // ─── Params block ──────────────────────────────────────────────

  describe('params block', () => {
    it('parses params with scalar types', () => {
      const { root } = parse(`\
/users/:id {
    params {
        id: uuid
    }
    get
}`);
      const params = root.routes[0]!.params;
      expect(params).toHaveLength(1);
      expect(params![0]!.name).toBe('id');
      expect(params![0]!.type).toMatchObject({ kind: 'scalar', name: 'uuid' });
    });

    it('parses multiple params', () => {
      const { root } = parse(`\
/users/:id/posts/:postId {
    params {
        id: uuid
        postId: uuid
    }
    get
}`);
      const params = root.routes[0]!.params;
      expect(params).toHaveLength(2);
      expect(params![0]!.name).toBe('id');
      expect(params![1]!.name).toBe('postId');
    });
  });

  // ─── HTTP methods ──────────────────────────────────────────────

  describe('HTTP methods', () => {
    it('parses GET operation', () => {
      const { root } = parse('/users { get }');
      expect(root.routes[0]!.operations[0]!.method).toBe('get');
    });

    it('parses POST operation', () => {
      const { root } = parse('/users { post }');
      expect(root.routes[0]!.operations[0]!.method).toBe('post');
    });

    it('parses PUT operation', () => {
      const { root } = parse('/users { put }');
      expect(root.routes[0]!.operations[0]!.method).toBe('put');
    });

    it('parses PATCH operation', () => {
      const { root } = parse('/users { patch }');
      expect(root.routes[0]!.operations[0]!.method).toBe('patch');
    });

    it('parses DELETE operation', () => {
      const { root } = parse('/users { delete }');
      expect(root.routes[0]!.operations[0]!.method).toBe('delete');
    });

    it('parses operation with no body', () => {
      const { root } = parse('/users { delete }');
      const op = root.routes[0]!.operations[0]!;
      expect(op.method).toBe('delete');
      expect(op.request).toBeUndefined();
      expect(op.response).toBeUndefined();
    });
  });

  // ─── Request block ─────────────────────────────────────────────

  describe('request block', () => {
    it('parses JSON request with body type', () => {
      const { root } = parse(`\
/users {
    post {
        request {
            application/json: CreateUserInput
        }
    }
}`);
      const request = root.routes[0]!.operations[0]!.request;
      expect(request).toBeDefined();
      expect(request!.contentType).toBe('application/json');
      expect(request!.bodyType).toBe('CreateUserInput');
    });

    it('parses multipart request', () => {
      const { root } = parse(`\
/uploads {
    post {
        request {
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
    get {
        response {
            200 {
                application/json: array(User)
            }
        }
    }
}`);
      const response = root.routes[0]!.operations[0]!.response;
      expect(response).toBeDefined();
      expect(response!.statusCode).toBe(200);
      expect(response!.contentType).toBe('application/json');
      expect(response!.bodyType).toBe('array(User)');
    });

    it('parses response with no body', () => {
      const { root } = parse(`\
/users/:id {
    delete {
        response {
            204
        }
    }
}`);
      const response = root.routes[0]!.operations[0]!.response;
      expect(response).toBeDefined();
      expect(response!.statusCode).toBe(204);
      expect(response!.bodyType).toBeUndefined();
    });
  });

  // ─── Query block ─────────────────────────────────────────────

  describe('query block', () => {
    it('parses query with typed parameters', () => {
      const { root } = parse(`\
/users {
    get {
        query {
            page: int
            limit: int
        }
        response {
            200 {
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

    it('leaves query undefined when not declared', () => {
      const { root } = parse('/users { get }');
      expect(root.routes[0]!.operations[0]!.query).toBeUndefined();
    });
  });

  // ─── Headers block ──────────────────────────────────────────

  describe('headers block', () => {
    it('parses headers with typed parameters', () => {
      const { root } = parse(`\
/users {
    get {
        headers {
            authorization: string
            x-request-id: uuid
        }
        response {
            200 {
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

    it('leaves headers undefined when not declared', () => {
      const { root } = parse('/users { get }');
      expect(root.routes[0]!.operations[0]!.headers).toBeUndefined();
    });
  });

  // ─── Service block ────────────────────────────────────────────

  describe('service block', () => {
    it('parses service with class and method', () => {
      const { root } = parse(`\
/users/:id {
    put {
        service { LedgerService.updateUser }
        response {
            200 {
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
    post {
        service { TransfersService }
        request {
            application/json: CreateTransferIntent
        }
        response {
            201 {
                application/json: TransferIntent
            }
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.service).toBe('TransfersService');
    });

    it('leaves service undefined when not declared', () => {
      const { root } = parse('/users { get }');
      expect(root.routes[0]!.operations[0]!.service).toBeUndefined();
    });
  });

  // ─── Multiple operations / routes ──────────────────────────────

  describe('multiple operations and routes', () => {
    it('parses multiple HTTP methods under one route', () => {
      const { root } = parse(`\
/users {
    get
    post
}`);
      expect(root.routes[0]!.operations).toHaveLength(2);
      expect(root.routes[0]!.operations[0]!.method).toBe('get');
      expect(root.routes[0]!.operations[1]!.method).toBe('post');
    });

    it('parses multiple routes', () => {
      const { root } = parse(`\
/users {
    get
}

/posts {
    get
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
    get
}

/valid {
    get
}`);
      expect(diag.hasErrors()).toBe(true);
    });
  });

  // ─── Full example ──────────────────────────────────────────────

  describe('full example', () => {
    it('parses a complete route with params, request, and response', () => {
      const { root, diag } = parse(`\
/users/:id {
    params {
        id: uuid
    }
    get {
        response {
            200 {
                application/json: User
            }
        }
    }
    put {
        request {
            application/json: UpdateUserInput
        }
        response {
            200 {
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
      expect(getOp.response!.statusCode).toBe(200);
      expect(getOp.response!.bodyType).toBe('User');

      const putOp = route.operations[1]!;
      expect(putOp.method).toBe('put');
      expect(putOp.request!.bodyType).toBe('UpdateUserInput');
      expect(putOp.response!.bodyType).toBe('User');
    });
  });
});
