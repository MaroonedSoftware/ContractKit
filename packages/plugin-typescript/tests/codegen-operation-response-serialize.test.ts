import { describe, it, expect } from 'vitest';
import { computeModelsWithScalar, decomposeCk, DiagnosticCollector, parseCk } from '@contractkit/core';
import type { OpCodegenOptions } from '../src/codegen-operation.js';
import { generateOp } from '../src/codegen-operation.js';
import { generateContract } from '../src/codegen-contract.js';
import { computeModelsWithSerializer } from '../src/codegen-serialize.js';
import { FASTIFY_SERVER_FRAMEWORK } from '../src/server-framework-fastify.js';

/**
 * A router writes a response body through the response serializer its type calls for, so a `date`
 * or `time` goes out in its contract format rather than as `DateTime.toJSON()`'s full timestamp,
 * which every SDK's `DateTime.fromFormat` rejects.
 */

const MODELS = `
contract Release: {
    version: string
    date: date
    at: time("HH:mm")
}
contract Note: {
    text: string
    at: datetime
}
contract Ledger: {
    total: bigint
    closedOn: date
}
`;

/** `GET /releases` with the given `response:` block lines, plus any extra operation fields. */
const releasesOp = (response: string, extra = '') => `${MODELS}
operation /releases: {
    get: {
        service: ReleaseService.list
        ${extra}
        response: {
            ${response}
        }
    }
}
`;

/** The router for `.ck` source, with the model sets the plugin passes a server router. */
function routerFor(source: string, overrides: Partial<OpCodegenOptions> = {}): string {
    const diag = new DiagnosticCollector();
    const { contract, op } = decomposeCk(parseCk(source, '/project/contracts/releases.ck', diag));
    expect(diag.getAll().filter(d => d.severity === 'error')).toEqual([]);
    const models = new Map(contract.models.map(m => [m.name, m]));
    const modelsWithSerializer = computeModelsWithSerializer(contract.models, models, 'response');
    const typesPath = '/project/src/types/releases.ts';
    const modelOutPaths = new Map<string, string>();
    for (const m of contract.models) modelOutPaths.set(m.name, typesPath);
    for (const m of modelsWithSerializer) modelOutPaths.set(`serialize${m}`, typesPath);
    return generateOp(op, {
        outPath: '/project/src/routes/releases.router.ts',
        modelOutPaths,
        models,
        modelsWithSerializer,
        modelsWithBigInt: computeModelsWithScalar(contract.models, new Set(['bigint'])),
        ...overrides,
    });
}

describe('generateOp: response bodies holding a date or time', () => {
    it("writes a model body through the model's serializer, imported beside the model", () => {
        const router = routerFor(releasesOp('200: { application/json: Release }'));
        // `ctx.body = result` wrote the date as DateTime.toJSON()'s full timestamp.
        expect(router).toContain('ctx.body = serializeRelease(result);');
        expect(router).toContain("import { Release, serializeRelease } from '../types/releases.js';");
    });

    it('maps an array of models through the serializer', () => {
        expect(routerFor(releasesOp('200: { application/json: array(Release) }'))).toContain('ctx.body = result.map(serializeRelease);');
    });

    it('wraps a body with no serializer of its own in one the router declares, with the helper it calls', () => {
        const router = routerFor(releasesOp('200: { application/json: { latest: Release, since: date, items: record(string, Release) } }'));
        expect(router).toContain('ctx.body = __serializeList200(result);');
        expect(router).toContain('function __serializeList200(value: unknown): unknown {');
        expect(router).toContain(`__o0["since"] = __wireDt(__o0["since"], 'yyyy-MM-dd');`);
        expect(router).toContain(`__o0["latest"] = serializeRelease(__o0["latest"] as never);`);
        expect(router.match(/const __wireDt = /g)).toHaveLength(1);
        expect(router).toContain("import { Release, serializeRelease } from '../types/releases.js';");
    });

    it('wraps a bare date body', () => {
        const router = routerFor(releasesOp('200: { application/json: date }'));
        expect(router).toContain('ctx.body = __serializeList200(result);');
        expect(router).toContain(`__v = __wireDt(__v, 'yyyy-MM-dd');`);
    });

    it('writes a body with no date or time exactly as before', () => {
        const router = routerFor(releasesOp('200: { application/json: Note }'));
        expect(router).toContain('ctx.body = result;');
        expect(router).not.toContain('serialize');
        expect(router).not.toContain('__wireDt');
    });

    it('writes every body as the service returned it when no serializer set is given', () => {
        const router = routerFor(releasesOp('200: { application/json: Release }'), { modelsWithSerializer: undefined });
        expect(router).toContain('ctx.body = result;');
        expect(router).not.toContain('serialize');
    });

    it('serializes the value validation returns, when responses are validated', () => {
        const router = routerFor(releasesOp('200: { application/json: Release }'), { validateResponses: true });
        expect(router).toContain('ctx.body = serializeRelease(await parseAndValidate(result, Release, 500));');
        const list = routerFor(releasesOp('200: { application/json: array(Release) }'), { validateResponses: true });
        expect(list).toContain('ctx.body = (await parseAndValidate(result, z.array(Release), 500)).map(serializeRelease);');
    });

    it('serializes before bigIntReplacer stringifies', () => {
        expect(routerFor(releasesOp('200: { application/json: Ledger }'))).toContain(
            'ctx.body = JSON.stringify(serializeLedger(result), bigIntReplacer);',
        );
    });

    it('leaves a non-JSON mime as the service built it', () => {
        const router = routerFor(
            releasesOp('200: {\n                application/json: Release\n                application/xml: Release\n            }'),
        );
        expect(router).toContain(
            [
                `    if (result.contentType === 'application/json') {`,
                `        ctx.body = serializeRelease(result.body);`,
                `    } else {`,
                `        ctx.body = result.body;`,
                `    }`,
            ].join('\n'),
        );
        const text = routerFor(releasesOp('200: { text/plain: string }'));
        expect(text).toContain('ctx.body = result;');
    });

    it('picks each mime its own serializer when a status carries different bodies', () => {
        const router = routerFor(
            releasesOp(
                '200: {\n                application/json: Release\n                application/vnd.ledger+json: Ledger\n                text/csv: string\n            }',
            ),
        );
        // The bigint arm first, then each serializer behind its own test, and the rest as returned.
        expect(router).toContain(
            [
                `    if (result.contentType === 'application/vnd.ledger+json') {`,
                `        ctx.body = JSON.stringify(serializeLedger(result.body), bigIntReplacer);`,
                `    } else if (result.contentType === 'application/json') {`,
                `        ctx.body = serializeRelease(result.body);`,
                `    } else {`,
                `        ctx.body = result.body;`,
                `    }`,
            ].join('\n'),
        );
    });

    it('serializes each status of a multi-status operation on its own', () => {
        const router = routerFor(
            releasesOp(
                '200: { application/json: Release }\n            201: { application/json: array(Release) }\n            404: { application/json: Note }',
            ),
        );
        expect(router).toContain('            ctx.body = serializeRelease(result.body);');
        expect(router).toContain('            ctx.body = result.body.map(serializeRelease);');
        expect(router).toContain('            ctx.body = result.body;');
    });

    it('writes a date or time response header in its contract format', () => {
        const router = routerFor(
            releasesOp(
                '200: {\n                headers: {\n                    x-day: date\n                    x-at?: time("HH:mm")\n                    x-count: int\n                }\n                application/json: Release\n            }',
            ),
        );
        expect(router).toContain(`ctx.set('x-day', result.headers["xDay"].toFormat('yyyy-MM-dd'));`);
        expect(router).toContain(`if (result.headers["xAt"] !== undefined) ctx.set('x-at', result.headers["xAt"].toFormat('HH:mm'));`);
        expect(router).toContain(`ctx.set('x-count', String(result.headers["xCount"]));`);
        expect(router).toContain('ctx.body = serializeRelease(result.body);');
    });

    it('writes the body through the serializer on Fastify too', () => {
        const router = routerFor(releasesOp('200: { application/json: Release }'), { framework: FASTIFY_SERVER_FRAMEWORK });
        expect(router).toContain('return reply.send(serializeRelease(result));');
        expect(routerFor(releasesOp('200: { application/json: Ledger }'), { framework: FASTIFY_SERVER_FRAMEWORK })).toContain(
            'return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(serializeLedger(result));',
        );
    });

    it('writes with exactly the format strings the schemas parse with', () => {
        const source = `
contract Booking: {
    day: date("MM/dd/yyyy")
    at: time
    back: date
    opens: time("HH:mm")
}
`;
        const diag = new DiagnosticCollector();
        const { contract } = decomposeCk(parseCk(source, 'booking.ck', diag));
        const models = contract.models;
        const modelMap = new Map(models.map(m => [m.name, m]));
        const types = generateContract(contract, {
            modelsWithSerializer: computeModelsWithSerializer(models, modelMap, 'response'),
            serializeDirection: 'response',
            modelMap,
            target: 'server',
        });
        const formats = (re: RegExp) => [...types.matchAll(re)].map(m => m[1]).sort();
        const parsed = formats(/DateTime\.fromFormat\(val, '([^']+)'\)/g);
        expect(parsed).toEqual(['HH:mm', 'HH:mm:ss', 'MM/dd/yyyy', 'yyyy-MM-dd']);
        expect(formats(/__wireDt\([^,]+, '([^']+)'\)/g)).toEqual(parsed);
    });
});
