import { parseCk, decomposeCk, validateOp, validateRefs, applyOptionsDefaults, DiagnosticCollector } from '@contractkit/core';
import { generateContract } from '../src/codegen-contract.js';
import { generateOp } from '../src/codegen-operation.js';
import { generateSdk } from '../src/codegen-sdk.js';
import { SIMPLE_USER_CONTRACT, VISIBILITY_CONTRACT, INHERITANCE_CONTRACT, SIMPLE_USERS_OP, PARAMETERIZED_OP } from './helpers.js';

function compileContractSource(source: string) {
    const diag = new DiagnosticCollector();
    const ck = parseCk(source, 'test.ck', diag);
    const { contract } = decomposeCk(ck);
    const output = generateContract(contract);
    return { root: contract, output, diag };
}

function compileOpSource(source: string, file = 'users.ck') {
    const diag = new DiagnosticCollector();
    const ck = parseCk(source, file, diag);
    const { op } = decomposeCk(ck);
    const output = generateOp(op);
    return { root: op, output, diag };
}

describe('Contract pipeline (source -> parse -> codegen)', () => {
    it('compiles a simple contract to valid Zod schema code', () => {
        const { output, diag } = compileContractSource(SIMPLE_USER_CONTRACT);
        expect(diag.hasErrors()).toBe(false);
        expect(output).toContain("import { z } from 'zod';");
        expect(output).toContain('id: z.uuid()');
        expect(output).toContain('name: z.string()');
        expect(output).toContain('email: z.email()');
        expect(output).toContain('age: z.coerce.number().optional()');
        expect(output).toContain(`active: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).default(true)`);
    });

    it('compiles a contract with visibility to three-schema pattern', () => {
        const { output, diag } = compileContractSource(VISIBILITY_CONTRACT);
        expect(diag.hasErrors()).toBe(false);
        expect(output).toContain('const UserBase = z.strictObject({');
        expect(output).toContain('export const User = z.strictObject({');
        expect(output).toContain('export const UserInput = z.strictObject({');

        // Read schema (User) should not contain writeonly 'password'
        const readSection = output.split('export const User =')[1]!.split('});')[0]!;
        expect(readSection).not.toContain('password');

        // Write schema (UserInput) should not contain readonly 'id'
        const writeSection = output.split('export const UserInput =')[1]!.split('});')[0]!;
        expect(writeSection).not.toContain('id:');
    });

    it('compiles a contract with inheritance', () => {
        const { output, diag } = compileContractSource(INHERITANCE_CONTRACT);
        expect(diag.hasErrors()).toBe(false);
        expect(output).toContain('User.extend({');
        expect(output).toContain('z.enum(["admin", "superadmin"])');
    });

    it('compiles a contract with all type kinds', () => {
        const source = `\
contract Kitchen: {
    tags: array(string)
    coords: tuple(number, number)
    meta: record(string, unknown)
    status: enum(open, closed)
    kind: literal("kitchen")
    value: string | number
    ref: Address
    children: lazy(Kitchen)
}`;
        const { output, diag } = compileContractSource(source);
        expect(diag.hasErrors()).toBe(false);
        expect(output).toContain('z.array(z.string())');
        expect(output).toContain('z.tuple([z.coerce.number(), z.coerce.number()])');
        expect(output).toContain('z.record(z.string(), z.unknown())');
        expect(output).toContain('z.enum(["open", "closed"])');
        expect(output).toContain('z.literal("kitchen")');
        expect(output).toContain('z.union([z.string(), z.coerce.number()])');
        expect(output).toContain('Address');
        expect(output).toContain('z.lazy(() => Kitchen)');
    });

    it('includes DateTime import when date fields are used', () => {
        const source = `\
contract Event: {
    startDate: date
    createdAt: datetime
}`;
        const { output } = compileContractSource(source);
        expect(output).toContain("import { DateTime } from 'luxon';");
    });
});

describe('OP pipeline (source -> parse -> codegen)', () => {
    it('compiles a simple operation to Koa router code', () => {
        const { output, diag } = compileOpSource(SIMPLE_USERS_OP);
        expect(diag.hasErrors()).toBe(false);
        expect(output).not.toContain("import { z } from 'zod';");
        expect(output).toContain('ServerKitRouter');
        expect(output).toContain("UsersRouter.get('/users'");
        expect(output).toContain("UsersRouter.post('/users'");
        expect(output).toContain("bodyParserMiddleware(['json'])");
        expect(output).toContain('ctx.status = 201');
    });

    it('compiles an operation with params, request, and response', () => {
        const { output, diag } = compileOpSource(PARAMETERIZED_OP);
        expect(diag.hasErrors()).toBe(false);
        expect(output).toContain("UsersRouter.get('/users/:id'");
        expect(output).toContain("UsersRouter.delete('/users/:id'");
        expect(output).toContain('parseAndValidate(');
        expect(output).toContain('id: z.uuid()');
    });

    it('uses correct router name for dotted file names', () => {
        const source = `operation /items: { get: {} }`;
        const { output } = compileOpSource(source, 'ledger.items.ck');
        expect(output).toContain('LedgerItemsRouter');
    });
});

describe('undeclared path param warnings', () => {
    it('warns when a route has path params but no params block', () => {
        const source = `operation /users/{id}: { get: {} }`;
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'test.ck', diag);
        const { op } = decomposeCk(ck);
        validateOp(op, diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('{id}');
    });

    it('warns for each undeclared param', () => {
        const source = `operation /users/{userId}/posts/{postId}: { get: {} }`;
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'test.ck', diag);
        const { op } = decomposeCk(ck);
        validateOp(op, diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(2);
        expect(warnings[0]!.message).toContain('{userId}');
        expect(warnings[1]!.message).toContain('{postId}');
    });

    it('does not warn when all path params are declared', () => {
        const source = `operation /users/{id}: {\n    params: {\n        id: uuid\n    }\n    get: {}\n}`;
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'test.ck', diag);
        const { op } = decomposeCk(ck);
        validateOp(op, diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(0);
    });

    it('warns only for the subset of undeclared params', () => {
        const source = `operation /accounts/{accountId}/entries/{entryId}: {\n    params: {\n        accountId: uuid\n    }\n    get: {}\n}`;
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'test.ck', diag);
        const { op } = decomposeCk(ck);
        validateOp(op, diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('{entryId}');
    });

    it('does not warn when params uses a type reference', () => {
        const source = `operation /users/{id}: {\n    params: UserParams\n    get: {}\n}`;
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'test.ck', diag);
        const { op } = decomposeCk(ck);
        validateOp(op, diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(0);
    });

    it('does not warn for routes without path params', () => {
        const source = `operation /users: { get: {} }`;
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'test.ck', diag);
        const { op } = decomposeCk(ck);
        validateOp(op, diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(0);
    });
});

describe('param type warnings', () => {
    it('does not warn when param types are specified', () => {
        const diag = new DiagnosticCollector();
        const ck = parseCk(PARAMETERIZED_OP, 'test.ck', diag);
        const { op } = decomposeCk(ck);
        validateOp(op, diag);
        const warnings = diag.getAll().filter(d => d.message.includes('no explicit type'));
        expect(warnings).toHaveLength(0);
    });
});

describe('error handling pipeline', () => {
    it('reports diagnostics for invalid contract source', () => {
        const { diag } = compileContractSource('Bad name: string');
        expect(diag.hasErrors()).toBe(true);
    });

    it('reports diagnostics for invalid OP source', () => {
        const { diag } = compileOpSource('no-slash { get: {} }');
        expect(diag.hasErrors()).toBe(true);
    });
});

describe('options-level header globals parity', () => {
    function compileOp(source: string) {
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'widgets.ck', diag);
        applyOptionsDefaults(ck, diag);
        const { op } = decomposeCk(ck);
        return { server: generateOp(op), sdk: generateSdk(op), diag };
    }

    // Strip source-line refs (e.g. `widgets.ck#L7`) so we can compare two equivalent
    // shapes whose operation sits on different lines in the source.
    const stripLineRefs = (s: string) => s.replace(/widgets\.ck#L\d+/g, 'widgets.ck#L?');

    it('options-level request headers produce the same server and SDK output as inlined headers', () => {
        const globalsForm = `
options { request: { headers: {
    x-request-id: uuid
    authorization: string
} } }

operation /widgets: {
    get: {
        response: { 200: { application/json: Widget } }
    }
}`;
        const inlinedForm = `
operation /widgets: {
    get: {
        headers: {
            x-request-id: uuid
            authorization: string
        }
        response: { 200: { application/json: Widget } }
    }
}`;
        const a = compileOp(globalsForm);
        const b = compileOp(inlinedForm);
        expect(a.diag.hasErrors()).toBe(false);
        expect(b.diag.hasErrors()).toBe(false);
        expect(stripLineRefs(a.server)).toBe(stripLineRefs(b.server));
        expect(stripLineRefs(a.sdk)).toBe(stripLineRefs(b.sdk));
    });

    it('options-level response headers on primary status produce the same server and SDK output as inlined headers', () => {
        const globalsForm = `
options { response: { headers: {
    x-request-id: uuid
} } }

operation /widgets: {
    get: {
        response: { 200: { application/json: Widget } }
    }
}`;
        const inlinedForm = `
operation /widgets: {
    get: {
        response: {
            200: {
                application/json: Widget
                headers: { x-request-id: uuid }
            }
        }
    }
}`;
        const a = compileOp(globalsForm);
        const b = compileOp(inlinedForm);
        expect(a.diag.hasErrors()).toBe(false);
        expect(b.diag.hasErrors()).toBe(false);
        expect(stripLineRefs(a.server)).toBe(stripLineRefs(b.server));
        expect(stripLineRefs(a.sdk)).toBe(stripLineRefs(b.sdk));
    });

    it('headers: none on an operation suppresses the global request header merge', () => {
        const source = `
options { request: { headers: { x-request-id: uuid } } }
operation /widgets: {
    get: {
        headers: none
        response: { 200: { application/json: Widget } }
    }
}`;
        const { server, sdk } = compileOp(source);
        // the request header should not appear in either output
        expect(server).not.toContain("'x-request-id'");
        expect(sdk).not.toContain("'x-request-id'");
    });
});

describe('cross-file type reference validation', () => {
    it('warns when a contract references an undefined model', () => {
        const diag = new DiagnosticCollector();
        const ck = parseCk('contract Order: { customer: NonExistentModel }', 'order.ck', diag);
        const { contract } = decomposeCk(ck);
        validateRefs([contract], [], diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes('NonExistentModel'))).toBe(true);
    });

    it('does not warn when referenced model exists in another file', () => {
        const diag = new DiagnosticCollector();
        const ck1 = parseCk('contract User: { name: string }', 'user.ck', diag);
        const ck2 = parseCk('contract Order: { customer: User }', 'order.ck', diag);
        const { contract: contract1 } = decomposeCk(ck1);
        const { contract: contract2 } = decomposeCk(ck2);
        validateRefs([contract1, contract2], [], diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning' && d.message.includes('User'));
        expect(warnings).toHaveLength(0);
    });

    it('warns when base model is undefined', () => {
        const diag = new DiagnosticCollector();
        const ck = parseCk('contract Admin: MissingBase & { role: string }', 'admin.ck', diag);
        const { contract } = decomposeCk(ck);
        validateRefs([contract], [], diag);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes('MissingBase'))).toBe(true);
    });

    it('warns when an operation references an undefined body type', () => {
        const diag = new DiagnosticCollector();
        const ck = parseCk(
            `\
operation /users: {
    get: {
        response: {
            200: {
                application/json: MissingType
            }
        }
    }
}`,
            'users.ck',
            diag,
        );
        const { op } = decomposeCk(ck);
        const diagAll = new DiagnosticCollector();
        validateRefs([], [op], diagAll);
        const warnings = diagAll.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes('MissingType'))).toBe(true);
    });

    it('does not warn for scalar type names in ops', () => {
        const diag = new DiagnosticCollector();
        const ck = parseCk(
            `\
operation /users: {
    get: {
        query: {
            page: int
        }
    }
}`,
            'users.ck',
            diag,
        );
        const { op } = decomposeCk(ck);
        const diagAll = new DiagnosticCollector();
        validateRefs([], [op], diagAll);
        const warnings = diagAll.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(0);
    });
});
