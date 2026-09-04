import { parseCk, decomposeCk, validateOp, validateRefs, applyOptionsDefaults, DiagnosticCollector } from '@contractkit/core';
import { generateContract } from '../src/codegen-contract.js';
import { generateOp } from '../src/codegen-operation.js';
import { generateSdk } from '../src/codegen-sdk.js';
import { generateMcpFile } from '../src/codegen-mcp.js';
import { SIMPLE_USER_CONTRACT, VISIBILITY_CONTRACT, INHERITANCE_CONTRACT, SIMPLE_USERS_OP, PARAMETERIZED_OP } from './helpers.js';

/** The narrowed numeric coercion `renderScalar` emits — see NUMERIC_PREPROCESS in codegen-contract. */
const NUM = `z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())`;
const NUM_INT = `z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())`;

function compileContractSource(source: string) {
    const diag = new DiagnosticCollector();
    const ck = parseCk(source, 'test.ck', diag);
    const { contract } = decomposeCk(ck);
    const output = generateContract(contract);
    return { root: contract, output, diag };
}

function compileOpSource(source: string, file = 'users.ck', options?: Parameters<typeof generateOp>[1]) {
    const diag = new DiagnosticCollector();
    const ck = parseCk(source, file, diag);
    const { op } = decomposeCk(ck);
    const output = generateOp(op, options);
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
        expect(output).toContain(`age: ${NUM}.optional()`);
        expect(output).toContain(`active: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).default(true)`);
    });

    it('compiles a decimal contract end to end, keeping bounds as exact strings', () => {
        // Exercises the real parse path rather than a hand-built AST: `buildScalarWithModifiers`
        // has to keep `0.01` as a string instead of routing it through `Number()`.
        const { output, root, diag } = compileContractSource(`
contract Payslip: {
    gross: decimal(min=0.01, max=999999.99, scale=2)
    rate: decimal
}
`);
        expect(diag.hasErrors()).toBe(false);

        const gross = root.models[0]!.fields[0]!.type as { min: unknown; max: unknown; scale: unknown };
        expect(gross.min).toBe('0.01');
        expect(gross.max).toBe('999999.99');
        expect(gross.scale).toBe(2);

        expect(output).toContain("import { Decimal } from 'decimal.js';");
        expect(output).toContain('Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });');
        expect(output).toContain(
            `gross: _ZodDecimal.refine((v) => v.decimalPlaces() <= 2 && v.gte('0.01') && v.lte('999999.99'), { message: 'Must be at most 2 decimal places, at least 0.01, at most 999999.99' })`,
        );
        expect(output).toContain('rate: _ZodDecimal');
    });

    it('compiles a contract with visibility to three-schema pattern', () => {
        const { output, diag } = compileContractSource(VISIBILITY_CONTRACT);
        expect(diag.hasErrors()).toBe(false);
        // No writeonly model extends User, so no UserBase is emitted — nothing would read it.
        expect(output).not.toContain('const UserBase');
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
        expect(output).toContain(`z.tuple([${NUM}, ${NUM}])`);
        expect(output).toContain('z.record(z.string(), z.unknown())');
        expect(output).toContain('z.enum(["open", "closed"])');
        expect(output).toContain('z.literal("kitchen")');
        expect(output).toContain(`z.union([z.string(), ${NUM}])`);
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

    it('validates response bodies end to end when validateResponses is on', () => {
        const { output, diag } = compileOpSource(SIMPLE_USERS_OP, 'users.ck', { validateResponses: true });
        expect(diag.hasErrors()).toBe(false);
        // GET returns array(User), POST returns User — both re-parsed against their own schema.
        expect(output).toContain('ctx.body = await parseAndValidate(result, z.array(User), 500);');
        expect(output).toContain('ctx.body = await parseAndValidate(result, User, 500);');
        expect(output).toContain("import { parseAndValidate } from '@maroonedsoftware/zod';");
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

describe('MCP pipeline (source -> parse -> codegen)', () => {
    function compileMcp(source: string, file = 'payments.ck') {
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, file, diag);
        const { op } = decomposeCk(ck);
        return { output: generateMcpFile(op, { includeInternal: false }), diag };
    }

    it('generates a tool handler from a parsed mcp block', () => {
        const source = `\
operation /payments/{id}: {
    params: { id: uuid }
    get: {
        mcp: {
            title: "Get Payment"
            description: "Fetch a payment by id."
            hint: readOnly, idempotent, nonDestructive
        }
        service: PaymentsService.getById
        response: { 200: { application/json: Payment } }
    }
}`;
        const { output, diag } = compileMcp(source);
        expect(diag.hasErrors()).toBe(false);
        expect(output).toContain('export class GetPaymentsByIdMcpTool implements McpToolHandler');
        expect(output).toContain("title: 'Get Payment'");
        expect(output).toContain('annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }');
        expect(output).toContain('const GetPaymentsByIdArgs = z.object({ id: z.uuid() });');
        expect(output).toContain('constructor(private readonly service: PaymentsService, private readonly policies: PolicyService) {}');
        expect(output).toContain('await requireMcpPolicy(context, this.policies, { policy: MFA_SATISFIED_POLICY });');
        expect(output).toContain('const result = await this.service.getById(id);');
        expect(output).toContain('export function registerPaymentsMcpTools(map: McpToolHandlerMap, container: Container): void {');
        expect(output).toContain("map.set('get_payments_by_id', container.get(GetPaymentsByIdMcpTool));");
    });

    it('generates a tool from mcp: true with an inferred name', () => {
        const source = `\
operation /payments: {
    post: {
        mcp: true
        service: PaymentsService.create
        request: { application/json: PaymentInput }
        response: { 201: { application/json: Payment } }
    }
}`;
        const { output, diag } = compileMcp(source);
        expect(diag.hasErrors()).toBe(false);
        expect(output).toContain("name: 'post_payments'");
        expect(output).toContain('const PostPaymentsArgs = z.object({ body: PaymentInput });');
        expect(output).not.toContain('annotations:');
    });

    it('emits nothing tool-like for a file with no flagged ops', () => {
        const source = `operation /payments: { get: { response: { 200: { application/json: Payment } } } }`;
        const { output } = compileMcp(source);
        expect(output).not.toContain('implements McpToolHandler');
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

// ─── Numeric coercion, as it actually behaves at runtime ─────────────────

describe('numeric scalar coercion', () => {
    /** Build the emitted schema for one field and run real Zod against it. */
    async function schemaFor(fieldDecl: string) {
        const { output } = compileContractSource(`contract M: {\n    ${fieldDecl}\n}\n`);
        const body = output.split('export const M = ')[1]!.split(');')[0]! + ')';
        const { z } = await import('zod');
        return new Function('z', `return ${body}`)(z) as { parse: (v: unknown) => unknown };
    }

    it('still coerces a string-shaped number, which query strings and headers depend on', async () => {
        const M = await schemaFor('n: number');
        expect(M.parse({ n: '42' })).toEqual({ n: 42 });
        expect(M.parse({ n: 42 })).toEqual({ n: 42 });
    });

    it('rejects the values Number() silently turned into a number', async () => {
        // `z.coerce.number()` is `Number(v)`: [] and '' become 0, null becomes 0, true becomes 1.
        // Each of these validated cleanly and handed the handler a value the client never sent.
        const M = await schemaFor('n: number');
        for (const bad of [[], {}, null, true, '']) {
            expect(() => M.parse({ n: bad }), `expected ${JSON.stringify(bad)} to be rejected`).toThrow();
        }
    });

    it('keeps min and max chaining onto the outer schema', async () => {
        const M = await schemaFor('n: int(min=1, max=5)');
        expect(M.parse({ n: '3' })).toEqual({ n: 3 });
        expect(() => M.parse({ n: 9 })).toThrow();
        expect(() => M.parse({ n: 2.5 })).toThrow();
    });

    it('leaves boolean alone, which was already safe', async () => {
        // Its preprocess maps only the two literal strings and hands everything else to
        // z.boolean(), which rejects it — the shape the numeric scalars now share.
        const M = await schemaFor('b: boolean');
        expect(M.parse({ b: 'true' })).toEqual({ b: true });
        expect(() => M.parse({ b: 1 })).toThrow();
    });
});
