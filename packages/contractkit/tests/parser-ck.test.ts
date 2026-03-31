import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCk } from '../src/parser.js';
import { DiagnosticCollector } from '../src/diagnostics.js';

function parse(source: string, file = 'test.ck') {
  const diag = new DiagnosticCollector();
  const ast = parseCk(source, file, diag);
  return { ast, diag };
}

describe('parseCk', () => {
  describe('options block', () => {
    it('parses keys section', () => {
      const { ast } = parse(`
options {
    keys: {
        area: ledger
    }
}
contract User: { name: string }
`);
      expect(ast.meta).toEqual({ area: 'ledger' });
      expect(ast.models).toHaveLength(1);
      expect(ast.models[0]!.name).toBe('User');
    });

    it('parses services section', () => {
      const { ast } = parse(`
options {
    services: {
        UserService: "#src/services/user.js"
    }
}
contract User: { name: string }
`);
      expect(ast.services).toEqual({ UserService: '#src/services/user.js' });
    });

    it('parses both keys and services', () => {
      const { ast } = parse(`
options {
    keys: {
        area: shared
    }
    services: {
        FooService: "#src/foo.js"
    }
}
contract User: { name: string }
`);
      expect(ast.meta).toEqual({ area: 'shared' });
      expect(ast.services).toEqual({ FooService: '#src/foo.js' });
    });

    it('parses empty options block', () => {
      const { ast } = parse(`
options {}
contract User: { name: string }
`);
      expect(ast.meta).toEqual({});
      expect(ast.services).toEqual({});
    });

    it('handles comments in options block', () => {
      const { ast } = parse(`
options {
    keys: {
        # metadata
        area: ledger
    }
}
contract User: { name: string }
`);
      expect(ast.meta).toEqual({ area: 'ledger' });
    });
  });

  describe('mixed contracts and operations', () => {
    it('parses contracts and operations in same file', () => {
      const { ast } = parse(`
contract User: {
    name: string
    email: email
}

operation /users: {
    get: {
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}
`);
      expect(ast.kind).toBe('ckRoot');
      expect(ast.models).toHaveLength(1);
      expect(ast.models[0]!.name).toBe('User');
      expect(ast.routes).toHaveLength(1);
      expect(ast.routes[0]!.path).toBe('/users');
    });

    it('parses operations with modifiers', () => {
      const { ast } = parse(`
operation(internal) /admin: {
    get: {}
}
`);
      expect(ast.routes).toHaveLength(1);
      expect(ast.routes[0]!.path).toBe('/admin');
      expect(ast.routes[0]!.modifiers).toEqual(['internal']);
    });

    it('parses contract modifiers (camel, loose)', () => {
      const { ast } = parse(`
contract parse(camel) mode(loose) Webhook: {
    eventType: string
}
`);
      expect(ast.models).toHaveLength(1);
      expect(ast.models[0]!.name).toBe('Webhook');
      expect(ast.models[0]!.mode).toBe('loose');
      expect(ast.models[0]!.parseCase).toBe('camel');
    });

    it('parses multiple contracts and operations interleaved', () => {
      const { ast } = parse(`
contract Headers: {
    x-id: uuid
}

contract Body: {
    data: string
}

operation /webhook: {
    post: {
        headers: Headers
        request: {
            application/json: Body
        }
        response: {
            204:
        }
    }
}

operation /health: {
    get: {
        response: {
            200: {
                application/json: { status: string }
            }
        }
    }
}
`);
      expect(ast.models).toHaveLength(2);
      expect(ast.models.map(m => m.name)).toEqual(['Headers', 'Body']);
      expect(ast.routes).toHaveLength(2);
      expect(ast.routes.map(r => r.path)).toEqual(['/webhook', '/health']);
    });
  });

  describe('deprecated modifier', () => {
    it('marks a contract as deprecated', () => {
      const { ast, diag } = parse(`
contract deprecated User: {
  id: string
}
`);
      expect(diag.hasErrors()).toBe(false);
      expect(ast.models[0]!.deprecated).toBe(true);
    });

    it('marks a field as deprecated', () => {
      const { ast, diag } = parse(`
contract User: {
  id: string
  legacyId: deprecated string
}
`);
      expect(diag.hasErrors()).toBe(false);
      expect(ast.models[0]!.fields[0]!.deprecated).toBeUndefined();
      expect(ast.models[0]!.fields[1]!.deprecated).toBe(true);
    });

    it('allows deprecated before visibility modifier on a field', () => {
      const { ast, diag } = parse(`
contract User: {
  password: deprecated writeonly string
}
`);
      expect(diag.hasErrors()).toBe(false);
      const field = ast.models[0]!.fields[0]!;
      expect(field.deprecated).toBe(true);
      expect(field.visibility).toBe('writeonly');
    });

    it('allows deprecated after visibility modifier on a field', () => {
      const { ast, diag } = parse(`
contract User: {
  password: writeonly deprecated string
}
`);
      expect(diag.hasErrors()).toBe(false);
      const field = ast.models[0]!.fields[0]!;
      expect(field.deprecated).toBe(true);
      expect(field.visibility).toBe('writeonly');
    });

    it('combines deprecated with other model modifiers', () => {
      const { ast, diag } = parse(`
contract deprecated mode(strip) LegacyUser: {
  id: string
}
`);
      expect(diag.hasErrors()).toBe(false);
      expect(ast.models[0]!.deprecated).toBe(true);
      expect(ast.models[0]!.mode).toBe('strip');
    });
  });

  describe('test.ck fixture', () => {
    it('parses the test.ck file', () => {
      const source = readFileSync(resolve(__dirname, '../../../contracts/test.ck'), 'utf-8');
      const { ast, diag } = parse(source, 'test.ck');

      expect(diag.hasErrors()).toBe(false);
      expect(ast.kind).toBe('ckRoot');

      // Options
      expect(ast.meta).toEqual({ area: 'counterparty' });
      expect(ast.services).toEqual({
        CounterpartyService: '#src/modules/counterparty/counterparty.service.js',
      });

      // Contracts
      expect(ast.models).toHaveLength(2);
      expect(ast.models[0]!.name).toBe('ModernTreasuryWebhookHeaders');
      expect(ast.models[0]!.fields).toHaveLength(6);
      expect(ast.models[1]!.name).toBe('ModernTreasuryWebhookTransaction');
      expect(ast.models[1]!.parseCase).toBe('camel');
      expect(ast.models[1]!.mode).toBe('loose');

      // Operations
      expect(ast.routes).toHaveLength(1);
      expect(ast.routes[0]!.path).toBe('/webhooks/moderntreasury');
      expect(ast.routes[0]!.modifiers).toEqual(['internal']);
      expect(ast.routes[0]!.operations).toHaveLength(1);
      expect(ast.routes[0]!.operations[0]!.method).toBe('post');
      expect(ast.routes[0]!.operations[0]!.security).toBe('none');
    });
  });

});
