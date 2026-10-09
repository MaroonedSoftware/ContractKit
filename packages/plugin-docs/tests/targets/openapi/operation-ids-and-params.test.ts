import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../../src/targets/openapi/codegen.js';
import type { OpenApiConfig } from '../../../src/targets/openapi/codegen.js';
import { contractRoot, enumType, field, model, opOperation, opResponse, opRoot, opRoute, refType, scalarType } from '../../helpers.js';

type Operation = { operationId?: string; parameters?: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[] };
const operation = (doc: Record<string, unknown>, path: string, method: string): Operation =>
    (doc.paths as Record<string, Record<string, Operation>>)[path]![method]!;

describe('OpenAPI operationIds', () => {
    // Two services that both name their read `list`, as many do.
    const roots = [
        opRoot([
            opRoute('/roles', [opOperation('get', { service: 'RolesService.list', name: 'List roles', responses: [opResponse(200)] })]),
            opRoute('/candidates', [
                opOperation('get', { service: 'CandidatesService.list', name: 'List candidates', responses: [opResponse(200)] }),
            ]),
            opRoute('/candidates/{id}', [opOperation('get', { service: 'CandidatesService.get', responses: [opResponse(200)] })], 'id'),
        ]),
    ];
    const build = (config: OpenApiConfig = {}) => buildOpenApiDocument({ contractRoots: [], opRoots: roots, config });

    it('keeps the service method name while it is unique, and falls back to the SDK name when it is not', () => {
        const doc = build();
        expect(operation(doc, '/roles', 'get').operationId).toBe('list');
        expect(operation(doc, '/candidates', 'get').operationId).toBe('listCandidates');
        expect(operation(doc, '/candidates/{id}', 'get').operationId).toBe('get');
    });

    it("uses the SDK's method names throughout when asked", () => {
        const doc = build({ operationIds: 'sdk' });
        expect(operation(doc, '/roles', 'get').operationId).toBe('listRoles');
        expect(operation(doc, '/candidates', 'get').operationId).toBe('listCandidates');
        expect(operation(doc, '/candidates/{id}', 'get').operationId).toBe('getCandidatesById');
    });

    it('numbers an id that is taken even as an SDK name', () => {
        const clash = opRoot([
            opRoute('/a', [opOperation('get', { sdk: 'fetch', responses: [opResponse(200)] })]),
            opRoute('/b', [opOperation('get', { sdk: 'fetch', responses: [opResponse(200)] })]),
        ]);
        const doc = buildOpenApiDocument({ contractRoots: [], opRoots: [clash], config: {} });
        expect([operation(doc, '/a', 'get').operationId, operation(doc, '/b', 'get').operationId]).toEqual(['fetch', 'fetch2']);
    });
});

describe('OpenAPI parameters from a model', () => {
    const contracts = [
        contractRoot([
            model('PageQuery', [
                field('page', scalarType('int'), { optional: true, description: 'Zero-based page number' }),
                field('sort', enumType('asc', 'desc'), { optional: true }),
            ]),
            model('RolesQuery', [field('status', enumType('open', 'closed'), { optional: true }), field('q', scalarType('string'))], {
                bases: ['PageQuery'],
            }),
            model('Tenant', [field('x-tenant', scalarType('uuid'))]),
            model('Slug', [], { type: scalarType('string') }),
        ]),
    ];
    const build = (query: unknown, headers?: unknown) =>
        buildOpenApiDocument({
            contractRoots: contracts,
            opRoots: [
                opRoot([
                    opRoute('/roles', [
                        opOperation('get', { query, ...(headers ? { headers } : {}), responses: [opResponse(200, refType('Slug'))] }),
                    ]),
                ]),
            ],
            config: {},
        });

    it('expands a query model into one parameter per field, its bases included', () => {
        const params = operation(build('RolesQuery'), '/roles', 'get').parameters!;
        expect(params.map(p => [p.name, p.in, p.required])).toEqual([
            ['page', 'query', false],
            ['sort', 'query', false],
            ['status', 'query', false],
            ['q', 'query', true],
        ]);
        expect(params[0]).toMatchObject({ description: 'Zero-based page number', schema: { type: 'integer' } });
        expect(params[1]!.schema).toEqual({ type: 'string', enum: ['asc', 'desc'] });
    });

    it('expands a header model the same way', () => {
        const params = operation(build(undefined, 'Tenant'), '/roles', 'get').parameters!;
        expect(params).toEqual([expect.objectContaining({ name: 'x-tenant', in: 'header', required: true })]);
    });

    it('keeps a single $ref parameter for a model with no fields', () => {
        const params = operation(build('Slug'), '/roles', 'get').parameters!;
        expect(params).toEqual([expect.objectContaining({ name: 'Slug', in: 'query', schema: { $ref: '#/components/schemas/Slug' } })]);
    });
});

describe('OpenAPI parameters from a formatted model', () => {
    it('names each parameter in the casing the model reads its input in', () => {
        const contracts = [
            contractRoot([
                model('Base', [field('pageSize', scalarType('int'), { optional: true })], { inputCase: 'snake' }),
                model('Filter', [field('fromDate', scalarType('date'), { optional: true })], { bases: ['Base'] }),
            ]),
        ];
        const doc = buildOpenApiDocument({
            contractRoots: contracts,
            opRoots: [opRoot([opRoute('/x', [opOperation('get', { query: 'Filter', responses: [opResponse(200)] })])])],
            config: {},
        });
        expect(operation(doc, '/x', 'get').parameters!.map(p => p.name)).toEqual(['page_size', 'from_date']);
    });

    it('lets each member of an intersection alias keep its own casing', () => {
        const contracts = [
            contractRoot([
                model('Snake', [field('fromDate', scalarType('date'), { optional: true })], { inputCase: 'snake' }),
                model('Plain', [field('regionCode', scalarType('string'), { optional: true })]),
                model('Both', [], { type: { kind: 'intersection', members: [refType('Snake'), refType('Plain')] } }),
            ]),
        ];
        const doc = buildOpenApiDocument({
            contractRoots: contracts,
            opRoots: [opRoot([opRoute('/x', [opOperation('get', { query: 'Both', responses: [opResponse(200)] })])])],
            config: {},
        });
        expect(operation(doc, '/x', 'get').parameters!.map(p => p.name)).toEqual(['from_date', 'regionCode']);
    });
});
