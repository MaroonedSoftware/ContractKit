import { describe, it, expect } from 'vitest';
import { DiagnosticCollector, computeModelsWithInput, decomposeCk, parseCk } from '@contractkit/core';
import type { ContractRootNode } from '@contractkit/core';
import { computeModelsWithWireInput } from '../src/codegen-wire-input.js';
import { generateContract } from '../src/codegen-contract.js';
import { generatePlainTypes } from '../src/codegen-plain-types.js';
import { generateSdk } from '../src/codegen-sdk.js';
import { contractRoot, field, model, opOperation, opRequest, opResponse, opRoot, opRoute, refType, scalarType } from './helpers.js';

/**
 * `format(input=)` on the request side: an SDK has to send the keys the server's schema parses,
 * which are not the keys of the model's own TypeScript type.
 */

function parseContracts(source: string): ContractRootNode {
    const diag = new DiagnosticCollector();
    const { contract } = decomposeCk(parseCk(source, 'test.ck', diag));
    expect(diag.getAll().filter(d => d.severity === 'error')).toEqual([]);
    return contract;
}

function wireSet(source: string, flavor: 'zod' | 'plain'): string[] {
    const root = parseContracts(source);
    return [...computeModelsWithWireInput(root.models, computeModelsWithInput(root.models), flavor)].sort();
}

/** The SDK types file for `source`, rendered the way the plugin renders it for `flavor`. */
function sdkTypes(source: string, flavor: 'zod' | 'plain'): string {
    const root = parseContracts(source);
    const modelsWithInput = computeModelsWithInput(root.models);
    const modelsWithWireInput = computeModelsWithWireInput(root.models, modelsWithInput, flavor);
    const context = { modelOutPaths: new Map<string, string>(), currentOutPath: '/out/test.types.ts', modelsWithInput, modelsWithWireInput };
    return flavor === 'zod' ? generateContract(root, context) : generatePlainTypes(root, context);
}

/** One emitted `WireInput` declaration, from its `export` line to the end of its statement. */
function wireDecl(out: string, name: string): string {
    const start = out.indexOf(`export interface ${name}WireInput`);
    if (start >= 0) return out.slice(start, out.indexOf('\n}', start) + 2);
    const alias = out.indexOf(`export type ${name}WireInput`);
    expect(alias, `no ${name}WireInput in:\n${out}`).toBeGreaterThanOrEqual(0);
    return out.slice(alias, out.indexOf(';', alias) + 1);
}

/**
 * Every schema the server file for `source` exports, evaluated with real Zod. The contracts used
 * with this stay clear of scalars whose runtime needs an import (datetime, decimal, json).
 */
async function serverSchemas(source: string): Promise<Record<string, { safeParse: (v: unknown) => { success: boolean } }>> {
    const out = generateContract(parseContracts(source));
    const names = [...out.matchAll(/^export const (\w+)/gm)].map(m => m[1]!);
    const body = out
        .split('\n')
        .filter(l => !l.startsWith('import ') && !l.startsWith('export type '))
        .join('\n')
        .replace(/^export const /gm, 'const ');
    const { z } = await import('zod');
    return new Function('z', `${body}\nreturn { ${names.join(', ')} };`)(z);
}

describe('computeModelsWithWireInput', () => {
    const SOURCE = `
contract format(input=pascal, output=snake) Token: { accessToken: string }
contract format(input=snake) Session: { userId: string }
contract format(output=snake) Receipt: { issuedTo: string }
contract Plain: { name: string }
contract Wrapper: { token: Token }
contract Deep: { wrappers: array(Wrapper) }
contract Holds: { receipt: Receipt }
contract format(output=snake) ReceiptOfSession: { session: Session }
contract Account: { id: readonly uuid, session: Session }
contract format(input=snake) Secret: { id: readonly uuid, userName: string }
contract Child: Session & { extra: string }
contract Tokens: array(Token)
`;

    it('plain types: every model format(input=) re-keys, directly or through a reference', () => {
        // Receipt, Holds: output casing only, and a plain interface already carries declared keys.
        // Secret: the server's split schema does not apply format() at all, so neither does the SDK.
        expect(wireSet(SOURCE, 'plain')).toEqual(['Account', 'Child', 'Deep', 'ReceiptOfSession', 'Session', 'Token', 'Tokens', 'Wrapper']);
    });

    it('zod: also a model nesting an output-cased schema, whose z.output keys differ from the wire', () => {
        // Holds is `z.infer<typeof Holds>`, so its `receipt` is typed in snake_case, but the server
        // parses the nested Receipt from camelCase. ReceiptOfSession drops out: a model whose own
        // transform is format(output=) is typed `z.input`, which is already the wire shape.
        expect(wireSet(SOURCE, 'zod')).toEqual(['Account', 'Child', 'Deep', 'Holds', 'Session', 'Token', 'Tokens', 'Wrapper']);
    });
});

describe('XWireInput declarations', () => {
    const SOURCE = `
contract format(input=pascal, output=snake) Token: {
    accessToken: string
    expiresIn?: int = 3600
    scope: string | null
}
contract format(input=snake) Order: {
    lineItems: array({ unitPrice: number })
    span: tuple({ fromDay: int }, int)
    byCode: record(string, { itemCode: string })
    note?: { sentBy: string }
}
contract Wrapper: { token: Token }
contract Tagged: Wrapper & { tag: string }
contract Child: Order & { extraNote: string }
contract Stamp: { stampedBy: string }
contract format(input=snake) Stamped: Stamp & { stampNote: string }
contract Account: { id: readonly uuid, secret: writeonly string, token: Token }
contract Tokens: array(Token)
`;

    for (const flavor of ['zod', 'plain'] as const) {
        describe(flavor, () => {
            const out = sdkTypes(SOURCE, flavor);

            it('keys a format(input=) contract as its schema parses it; a default makes a field optional', () => {
                expect(wireDecl(out, 'Token')).toBe(
                    [
                        'export interface TokenWireInput {',
                        '    AccessToken: string;',
                        '    ExpiresIn?: number;',
                        '    Scope: string | null;',
                        '}',
                    ].join('\n'),
                );
            });

            it('re-keys anonymous objects through arrays and nesting, but not inside a tuple or record', () => {
                // Mirrors renderType: the transform follows the object into arrays, unions and inline
                // objects, while renderTuple and renderRecord render their members without it.
                expect(wireDecl(out, 'Order')).toBe(
                    [
                        'export interface OrderWireInput {',
                        '    line_items: { unit_price: number }[];',
                        '    span: [{ fromDay: number }, number];',
                        '    by_code: Record<string, { itemCode: string }>;',
                        '    note?: { sent_by: string };',
                        '}',
                    ].join('\n'),
                );
            });

            it('refers to a nested contract by its own WireInput type', () => {
                expect(wireDecl(out, 'Wrapper')).toContain('    token: TokenWireInput;');
            });

            it('extends a base by its request-side name', () => {
                expect(wireDecl(out, 'Tagged')).toMatch(/^export interface TaggedWireInput extends WrapperWireInput \{\n {4}tag: string;\n\}$/);
            });

            it('flattens a contract that inherits format(), since its schema does', () => {
                const decl = wireDecl(out, 'Child');
                expect(decl).not.toContain('extends');
                expect(decl).toContain('line_items: { unit_price: number }[];');
                expect(decl).toContain('extra_note: string;');
            });

            it("keeps a plain base's fields on a format() contract, keyed by its casing", () => {
                // The schema inlines the base rather than extending it, so the request carries its fields too.
                expect(wireDecl(out, 'Stamped')).toBe(
                    ['export interface StampedWireInput {', '    stamped_by: string;', '    stamp_note: string;', '}'].join('\n'),
                );
            });

            it('leaves readonly fields out of a split contract and keeps writeonly ones', () => {
                const decl = wireDecl(out, 'Account');
                expect(decl).not.toContain('id:');
                expect(decl).toContain('secret: string;');
                expect(decl).toContain('token: TokenWireInput;');
            });

            it('renders a type alias over a WireInput type', () => {
                expect(wireDecl(out, 'Tokens')).toBe('export type TokensWireInput = TokenWireInput[];');
            });
        });
    }

    it('names the json scalar the way each flavour declares it', () => {
        const source = 'contract format(input=snake) Payload: { rawData: json }';
        expect(wireDecl(sdkTypes(source, 'zod'), 'Payload')).toContain('raw_data: _JsonValue;');
        expect(wireDecl(sdkTypes(source, 'plain'), 'Payload')).toContain('raw_data: JsonValue;');
    });

    it('is emitted into SDK type files only: server types get no WireInput', () => {
        const root = parseContracts(SOURCE);
        expect(generateContract(root)).not.toContain('WireInput');
        expect(generatePlainTypes(root)).not.toContain('WireInput');
    });

    it('imports a WireInput type from the file that declares it', () => {
        const token = model('Token', [field('accessToken', scalarType('string'))], { inputCase: 'pascal' });
        const wrapper = model('Wrapper', [field('token', refType('Token'))]);
        const modelsWithWireInput = computeModelsWithWireInput([token, wrapper], new Set(), 'plain');
        const context = {
            modelOutPaths: new Map([
                ['Token', '/out/token.types.ts'],
                ['TokenWireInput', '/out/token.types.ts'],
            ]),
            currentOutPath: '/out/wrapper.types.ts',
            modelsWithWireInput,
        };
        const root = contractRoot([wrapper], 'wrapper.ck');
        expect(generatePlainTypes(root, context)).toContain("import type { TokenWireInput } from './token.types.js';");
        expect(generateContract(root, context)).toContain("import { TokenWireInput } from './token.types.js';");
    });
});

describe('the server accepts what XWireInput describes', () => {
    // The declarations above are asserted as text; these run the same shapes through the schemas the
    // server parses with, so a drift between the two is a red test rather than a 400 in production.
    const SOURCE = `
contract format(input=pascal, output=snake) Token: {
    accessToken: string
    expiresIn?: int = 3600
}
contract format(input=snake) Order: {
    lineItems: array({ unitPrice: number })
    span: tuple({ fromDay: int }, int)
    byCode: record(string, { itemCode: string })
}
contract format(output=snake) Receipt: { issuedTo: string }
contract Wrapper: { token: Token }
contract Holds: { receipt: Receipt }
contract Child: Order & { extraNote: string }
contract Stamp: { stampedBy: string }
contract format(input=snake) Stamped: Stamp & { stampNote: string }
`;

    const wireBodies: Record<string, unknown> = {
        Token: { AccessToken: 'a', ExpiresIn: 60 },
        Order: { line_items: [{ unit_price: 2 }], span: [{ fromDay: 1 }, 2], by_code: { x: { itemCode: 'c' } } },
        Wrapper: { token: { AccessToken: 'a' } },
        Holds: { receipt: { issuedTo: 'me' } },
        Child: { line_items: [], span: [{ fromDay: 1 }, 2], by_code: {}, extra_note: 'n' },
        Stamped: { stamped_by: 'me', stamp_note: 'n' },
    };

    it.each(Object.entries(wireBodies))('%s parses in its wire casing', async (name, body) => {
        const schemas = await serverSchemas(SOURCE);
        expect(schemas[name]!.safeParse(body).success).toBe(true);
    });

    it('and rejects the post-transform keys the model type used to ask for', async () => {
        const schemas = await serverSchemas(SOURCE);
        expect(schemas.Token!.safeParse({ access_token: 'a' }).success).toBe(false);
        expect(schemas.Wrapper!.safeParse({ token: { access_token: 'a' } }).success).toBe(false);
        expect(schemas.Holds!.safeParse({ receipt: { issued_to: 'me' } }).success).toBe(false);
    });
});

describe('generateSdk request types', () => {
    const wire = new Set(['Token', 'Filter', 'Trace']);
    const options = { modelsWithOutput: new Set(['Token']), modelsWithWireInput: wire };

    it('types a request body with the WireInput variant and keeps the response in the output casing', () => {
        const root = opRoot([
            opRoute('/tokens', [
                opOperation('post', { sdk: 'mint', request: opRequest('Token'), responses: [opResponse(201, 'Token', 'application/json')] }),
            ]),
        ]);
        const out = generateSdk(root, options);
        expect(out).toContain('async mint(body: TokenWireInput): Promise<TokenOutput>');
        // `Token` itself is no longer named anywhere, so it is not imported either.
        expect(out).toMatch(/import type \{ TokenOutput, TokenWireInput \}/);
    });

    it('substitutes inside an inline body', () => {
        const root = opRoot([
            opRoute('/wrap', [
                opOperation('post', {
                    sdk: 'wrap',
                    request: opRequest({ kind: 'inlineObject', fields: [field('token', refType('Token'))] }),
                    responses: [opResponse(204)],
                }),
            ]),
        ]);
        expect(generateSdk(root, options)).toContain('async wrap(body: { token: TokenWireInput })');
    });

    it('types query and header objects by their WireInput variant too', () => {
        const root = opRoot([
            opRoute('/search', [opOperation('get', { sdk: 'search', query: 'Filter', headers: 'Trace', responses: [opResponse(204)] })]),
        ]);
        const out = generateSdk(root, options);
        expect(out).toContain('query?: FilterWireInput');
        expect(out).toContain('customHeaders?: TraceWireInput');
        expect(out).toMatch(/import type \{[^}]*FilterWireInput[^}]*TraceWireInput/);
    });

    it('leaves a path-params model alone: the URL reads its fields by their declared names', () => {
        const root = opRoot([opRoute('/filters/{id}', [opOperation('get', { sdk: 'getFilter', responses: [opResponse(204)] })], 'Filter')]);
        const out = generateSdk(root, options);
        expect(out).toContain('async getFilter(params: Filter)');
        expect(out).toContain('${encodeURIComponent(String(params.id))}');
    });
});
