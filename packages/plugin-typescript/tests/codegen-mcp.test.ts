import { describe, it, expect } from 'vitest';
import type { McpConfigNode } from '@contractkit/core';
import {
    generateMcpFile,
    generateMcpAggregator,
    generateMcpRouter,
    hasMcpOperations,
    deriveMcpRegisterFnName,
} from '../src/codegen-mcp.js';
import { opRoot, opRoute, opOperation, opParam, opRequest, opResponse, scalarType, loc } from './helpers.js';

function mcpBlock(over: Partial<McpConfigNode>): McpConfigNode {
    return { loc: loc(), ...over };
}

describe('hasMcpOperations', () => {
    it('is false when no op is flagged', () => {
        const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
        expect(hasMcpOperations(root)).toBe(false);
    });

    it('is true when an op is flagged', () => {
        const root = opRoot([opRoute('/users', [opOperation('get', { mcp: true, responses: [opResponse(200, 'User', 'application/json')] })])]);
        expect(hasMcpOperations(root)).toBe(true);
    });

    it('excludes internal ops unless includeInternal', () => {
        const root = opRoot([
            opRoute('/users', [opOperation('get', { mcp: true, responses: [opResponse(200, 'User', 'application/json')] })], undefined, ['internal']),
        ]);
        expect(hasMcpOperations(root)).toBe(false);
        expect(hasMcpOperations(root, true)).toBe(true);
    });
});

describe('generateMcpFile', () => {
    describe('op selection', () => {
        it('emits a tool class only for flagged ops', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', { sdk: 'listUsers', mcp: true, responses: [opResponse(200, 'User', 'application/json')] }),
                    opOperation('post', { sdk: 'createUser', request: opRequest('User'), responses: [opResponse(201, 'User', 'application/json')] }),
                ]),
            ]);
            const out = generateMcpFile(root);
            expect(out).toContain('export class ListUsersMcpTool');
            expect(out).not.toContain('CreateUserMcpTool');
        });

        it('skips mcp: false', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { sdk: 'listUsers', mcp: false, responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateMcpFile(root);
            expect(out).not.toContain('implements McpToolHandler');
        });

        it('skips internal ops unless includeInternal', () => {
            const root = opRoot([
                opRoute('/users', [opOperation('get', { sdk: 'listUsers', mcp: true, responses: [opResponse(200, 'User', 'application/json')] })], undefined, [
                    'internal',
                ]),
            ]);
            expect(generateMcpFile(root)).not.toContain('ListUsersMcpTool');
            expect(generateMcpFile(root, { includeInternal: true })).toContain('ListUsersMcpTool');
        });
    });

    describe('tool name + class name', () => {
        it('uses explicit mcp.name verbatim', () => {
            const root = opRoot([
                opRoute('/routes', [opOperation('post', { mcp: mcpBlock({ name: 'searchRoutes' }), request: opRequest('Query'), responses: [opResponse(200, 'RouteList', 'application/json')] })]),
            ]);
            const out = generateMcpFile(root);
            expect(out).toContain("name: 'searchRoutes'");
            expect(out).toContain('export class SearchRoutesMcpTool');
        });

        it('snake_cases the sdk field', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { sdk: 'listAllUsers', mcp: true, responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateMcpFile(root);
            expect(out).toContain("name: 'list_all_users'");
            expect(out).toContain('export class ListAllUsersMcpTool');
        });

        it('snake_cases the name field', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { name: 'Get User', mcp: true, responses: [opResponse(200, 'User', 'application/json')] })])]);
            expect(generateMcpFile(root)).toContain("name: 'get_user'");
        });

        it('infers snake_case name from method + path', () => {
            const root = opRoot([
                opRoute('/payments/{id}', [opOperation('get', { mcp: true, responses: [opResponse(200, 'Payment', 'application/json')] })], [opParam('id', scalarType('uuid'))]),
            ]);
            expect(generateMcpFile(root)).toContain("name: 'get_payments_by_id'");
        });
    });

    describe('definition metadata', () => {
        it('emits title, description, and only the defined annotations', () => {
            const root = opRoot([
                opRoute('/payments/{id}', [
                    opOperation('get', {
                        mcp: mcpBlock({ title: 'Get Payment', description: 'Fetch a payment by id.', readOnlyHint: true, idempotentHint: true, destructiveHint: false }),
                        responses: [opResponse(200, 'Payment', 'application/json')],
                    }),
                ], [opParam('id', scalarType('uuid'))]),
            ]);
            const out = generateMcpFile(root);
            expect(out).toContain("title: 'Get Payment'");
            expect(out).toContain("description: 'Fetch a payment by id.'");
            expect(out).toContain('annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }');
            expect(out).not.toContain('openWorldHint');
        });

        it('omits annotations when no hints set', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { mcp: true, responses: [opResponse(200, 'User', 'application/json')] })])]);
            expect(generateMcpFile(root)).not.toContain('annotations:');
        });

        it('falls back to op description', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { mcp: true, description: 'List users.', responses: [opResponse(200, 'User', 'application/json')] })])]);
            expect(generateMcpFile(root)).toContain("description: 'List users.'");
        });
    });

    describe('input schema + validation', () => {
        it('folds path params into a shared args const used for schema and validation', () => {
            const root = opRoot([
                opRoute('/payments/{id}', [opOperation('get', { mcp: true, responses: [opResponse(200, 'Payment', 'application/json')] })], [opParam('id', scalarType('uuid'))]),
            ]);
            const out = generateMcpFile(root);
            expect(out).toContain('const GetPaymentsByIdArgs = z.object({ id: z.uuid() });');
            expect(out).toContain("inputSchema: z.toJSONSchema(GetPaymentsByIdArgs, { unrepresentable: 'any' }) as Tool['inputSchema']");
            expect(out).toContain('const { id } = await parseAndValidate(args, GetPaymentsByIdArgs);');
        });

        it('nests the request body under a body field', () => {
            const root = opRoot([
                opRoute('/payments', [opOperation('post', { sdk: 'createPayment', mcp: true, request: opRequest('PaymentInput'), responses: [opResponse(201, 'Payment', 'application/json')] })]),
            ]);
            const out = generateMcpFile(root);
            expect(out).toContain('const CreatePaymentArgs = z.object({ body: PaymentInput });');
            expect(out).toContain('const { body } = await parseAndValidate(args, CreatePaymentArgs);');
        });
    });

    describe('service call + result', () => {
        it('injects the declared service and calls it', () => {
            const root = opRoot([
                opRoute('/payments/{id}', [opOperation('get', { mcp: true, service: 'PaymentsService.getById', responses: [opResponse(200, 'Payment', 'application/json')] })], [opParam('id', scalarType('uuid'))]),
            ]);
            const out = generateMcpFile(root);
            expect(out).toContain('constructor(private readonly service: PaymentsService) {}');
            expect(out).toContain('const result = await this.service.getById(id);');
            expect(out).toContain('structuredContent: result');
        });

        it('returns bare content (no structuredContent / outputSchema) for a void response', () => {
            const root = opRoot([
                opRoute('/payments/{id}', [opOperation('delete', { mcp: true, service: 'PaymentsService.remove', responses: [opResponse(204)] })], [opParam('id', scalarType('uuid'))]),
            ]);
            const out = generateMcpFile(root);
            expect(out).toContain('await this.service.remove(id);');
            expect(out).toContain("return { content: [{ type: 'text', text: 'OK' }] };");
            expect(out).not.toContain('structuredContent');
            expect(out).not.toContain('outputSchema');
        });

        it('emits outputSchema for an object response', () => {
            const root = opRoot([
                opRoute('/payments/{id}', [opOperation('get', { mcp: true, service: 'PaymentsService.getById', responses: [opResponse(200, 'Payment', 'application/json')] })], [opParam('id', scalarType('uuid'))]),
            ]);
            expect(generateMcpFile(root)).toContain("outputSchema: z.toJSONSchema(Payment, { unrepresentable: 'any' }) as Tool['outputSchema']");
        });
    });

    describe('imports + registration', () => {
        it('imports the MCP + injectkit primitives and emits a per-file register fn', () => {
            const root = opRoot(
                [opRoute('/payments/{id}', [opOperation('get', { mcp: true, service: 'PaymentsService.getById', responses: [opResponse(200, 'Payment', 'application/json')] })], [opParam('id', scalarType('uuid'))])],
                'payments.op',
            );
            const out = generateMcpFile(root);
            expect(out).toContain("import { Injectable, type Container } from 'injectkit';");
            expect(out).toContain("import type { McpToolHandler, McpToolHandlerMap, McpToolContext } from '@maroonedsoftware/mcp';");
            expect(out).toContain("import { parseAndValidate } from '@maroonedsoftware/zod';");
            expect(out).toContain('export function registerPaymentsMcpTools(map: McpToolHandlerMap, container: Container): void {');
            expect(out).toContain("map.set('get_payments_by_id', container.get(GetPaymentsByIdMcpTool));");
        });

        it('resolves service + schema imports via modelOutPaths', () => {
            const root = opRoot(
                [opRoute('/payments', [opOperation('post', { sdk: 'createPayment', mcp: true, service: 'PaymentsService.create', request: opRequest('PaymentInput'), responses: [opResponse(201, 'Payment', 'application/json')] })])],
                'payments.op',
            );
            const modelOutPaths = new Map<string, string>([
                ['Payment', '/api/src/types/payment.ts'],
                ['PaymentInput', '/api/src/types/payment.ts'],
            ]);
            const out = generateMcpFile(root, {
                outPath: '/api/src/mcp/payments.mcp.ts',
                modelOutPaths,
                modelsWithInput: new Set(['Payment']),
                servicePathTemplate: '#modules/{kebab}/{kebab}.service.js',
            });
            expect(out).toContain("import { PaymentsService } from '#modules/payments/payments.service.js';");
            expect(out).toContain("import { Payment, PaymentInput } from '../types/payment.js';");
        });
    });
});

describe('generateMcpAggregator', () => {
    it('imports each register fn and assembles one map', () => {
        const out = generateMcpAggregator([
            { registerFn: 'registerPaymentsMcpTools', importPath: './payments.mcp.js' },
            { registerFn: 'registerUsersMcpTools', importPath: './users.mcp.js' },
        ]);
        expect(out).toContain("import { McpToolHandlerMap } from '@maroonedsoftware/mcp';");
        expect(out).toContain("import { registerPaymentsMcpTools } from './payments.mcp.js';");
        expect(out).toContain('export function registerMcpTools(container: Container): McpToolHandlerMap {');
        expect(out).toContain('const map = new McpToolHandlerMap();');
        expect(out).toContain('registerPaymentsMcpTools(map, container);');
        expect(out).toContain('registerUsersMcpTools(map, container);');
        expect(out).toContain('container.register(McpToolHandlerMap, { useValue: map });');
    });
});

describe('generateMcpRouter', () => {
    it('emits a ServerKit route wired to the dispatcher at the configured path', () => {
        const out = generateMcpRouter({ path: '/mcp' });
        expect(out).toContain("import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';");
        expect(out).toContain("router.post('/mcp'");
        expect(out).toContain('ctx.container.get(McpDispatcher)');
        expect(out).toContain("dispatcher.sessionMode === 'stateful'");
    });

    it('parses the body before verifying the signature', () => {
        const out = generateMcpRouter({ path: '/mcp' });
        // `requireSignature` HMACs `ctx.rawBody`, which only `bodyParserMiddleware` populates,
        // so the parser has to run first. Asserting the whole route line pins the order too.
        expect(out).toContain("import { ServerKitRouter, bodyParserMiddleware, requireSignature } from '@maroonedsoftware/koa';");
        expect(out).toContain(
            "router.post('/mcp', bodyParserMiddleware(['json']), requireSignature('mcp', { policy: MCP_AUTH_POLICY }), async (ctx) => {",
        );
    });

    it('answers notifications with 202 rather than falling through to a 404', () => {
        const out = generateMcpRouter();
        // `dispatch` resolves undefined for a notification; an unset ctx.body 404s in errorMiddleware.
        expect(out).toContain('if (response) ctx.body = response;');
        expect(out).toContain('else ctx.status = 202;');
    });

    it('stringifies rawBody before JSON.parse', () => {
        const out = generateMcpRouter();
        // ctx.rawBody is BinaryLike; JSON.parse takes string.
        expect(out).toContain('JSON.parse(String(ctx.rawBody))');
        expect(out).not.toContain('JSON.parse(ctx.rawBody)');
    });

    it('hands the stateful transport the parsed body', () => {
        const out = generateMcpRouter();
        // The parser drains the stream and writes ctx.parsedBody; ctx.request.body is never set.
        expect(out).toContain('body: ctx.parsedBody');
        expect(out).not.toContain('ctx.request.body');
    });

    it('defaults the mount path to /mcp', () => {
        expect(generateMcpRouter()).toContain("router.post('/mcp'");
    });
});

describe('deriveMcpRegisterFnName', () => {
    it('derives from the op-root filename', () => {
        expect(deriveMcpRegisterFnName('payments.op')).toBe('registerPaymentsMcpTools');
        expect(deriveMcpRegisterFnName('ledger.categories.op')).toBe('registerLedgerCategoriesMcpTools');
    });
});
