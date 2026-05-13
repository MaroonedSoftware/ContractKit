import { describe, expect, it } from 'vitest';
import { buildCurl, locateItem } from '../src/client/api-item-utils.js';
import type { PreviewData, ResolvedOperation } from '@contractkit/explorer-ui';
import { operationId } from '@contractkit/explorer-ui';

function makeOp(overrides: Partial<ResolvedOperation> = {}): ResolvedOperation {
    return {
        filePath: '/work/api.ck',
        fileGroup: 'api.ck',
        routePath: '/payments/{id}',
        method: 'get',
        op: {
            method: 'get',
            responses: [],
            loc: { file: '/work/api.ck', line: 42 },
            ...(overrides.op ?? {}),
        },
        effectiveModifiers: [],
        ...overrides,
    };
}

describe('buildCurl', () => {
    it('emits a simple GET with the joined base URL and path', () => {
        const out = buildCurl(makeOp(), 'https://api.example.com');
        expect(out).toContain("curl -X GET");
        expect(out).toContain("'https://api.example.com/payments/${id}'");
    });

    it('strips a trailing slash from the base URL', () => {
        const out = buildCurl(makeOp(), 'https://api.example.com/');
        expect(out).toContain("'https://api.example.com/payments/${id}'");
    });

    it('substitutes path params as `${name}` placeholders', () => {
        const out = buildCurl(
            makeOp({ routePath: '/orgs/{org}/users/{userId}' }),
            'https://api.example.com',
        );
        expect(out).toContain('${org}');
        expect(out).toContain('${userId}');
    });

    it('emits `-H` lines for each declared header param', () => {
        const out = buildCurl(
            makeOp({
                op: {
                    method: 'get',
                    responses: [],
                    loc: { file: '/x.ck', line: 1 },
                    headers: {
                        kind: 'params',
                        nodes: [
                            { name: 'X-Token', optional: false, nullable: false, type: { kind: 'scalar', name: 'string' }, loc: { file: '/x.ck', line: 1 } },
                            { name: 'X-Trace', optional: true, nullable: false, type: { kind: 'scalar', name: 'string' }, loc: { file: '/x.ck', line: 2 } },
                        ],
                    },
                },
            }),
            'https://api.example.com',
        );
        expect(out).toContain("-H 'X-Token: <X-Token>'");
        expect(out).toContain("-H 'X-Trace: <X-Trace>'");
    });

    it('adds Content-Type and an empty JSON body when the operation accepts application/json', () => {
        const out = buildCurl(
            makeOp({
                op: {
                    method: 'post',
                    responses: [],
                    loc: { file: '/x.ck', line: 1 },
                    request: {
                        bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'Body' } }],
                    },
                },
                method: 'post',
            }),
            'https://api.example.com',
        );
        expect(out).toContain("-H 'Content-Type: application/json'");
        expect(out).toContain("--data '{}'");
    });

    it('also matches `+json` content types', () => {
        const out = buildCurl(
            makeOp({
                op: {
                    method: 'post',
                    responses: [],
                    loc: { file: '/x.ck', line: 1 },
                    request: {
                        bodies: [{ contentType: 'application/vnd.api+json', bodyType: { kind: 'ref', name: 'Body' } }],
                    },
                },
                method: 'post',
            }),
            'https://api.example.com',
        );
        expect(out).toContain("-H 'Content-Type: application/json'");
    });

    it('omits the body for non-JSON bodies', () => {
        const out = buildCurl(
            makeOp({
                op: {
                    method: 'post',
                    responses: [],
                    loc: { file: '/x.ck', line: 1 },
                    request: {
                        bodies: [{ contentType: 'multipart/form-data', bodyType: { kind: 'ref', name: 'Body' } }],
                    },
                },
                method: 'post',
            }),
            'https://api.example.com',
        );
        expect(out).not.toContain('--data');
    });
});

describe('locateItem', () => {
    const op = makeOp({ op: { method: 'get', responses: [], sdk: 'getPayment', loc: { file: '/work/api.ck', line: 42 } } });
    const data: PreviewData = {
        configMeta: { title: 'Test', version: '1.0.0' },
        operations: [op],
        models: [
            { filePath: '/work/types.ck', model: { kind: 'model', name: 'Payment', fields: [], loc: { file: '/work/types.ck', line: 7 } } },
        ],
        warnings: [],
    };

    it('resolves an operation selection to its file + line', () => {
        const id = operationId(op);
        expect(locateItem(data, { kind: 'operation', id })).toEqual({ file: '/work/api.ck', line: 42 });
    });

    it('resolves a model selection to its file + line', () => {
        expect(locateItem(data, { kind: 'model', name: 'Payment' })).toEqual({ file: '/work/types.ck', line: 7 });
    });

    it('returns undefined for unknown ids', () => {
        expect(locateItem(data, { kind: 'operation', id: 'op-nope' })).toBeUndefined();
        expect(locateItem(data, { kind: 'model', name: 'Ghost' })).toBeUndefined();
    });

    it('returns undefined for the overview selection', () => {
        expect(locateItem(data, { kind: 'overview' })).toBeUndefined();
    });
});
