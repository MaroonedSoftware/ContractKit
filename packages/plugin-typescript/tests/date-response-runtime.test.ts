import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { z } from 'zod';
import { dirname, join } from 'node:path';
import { computeModelsWithInput, computeModelsWithOutput, decomposeCk, DiagnosticCollector, parseCk } from '@contractkit/core';
import { createTypescriptPlugin } from '../src/index.js';

/**
 * A `date` or `time` in a response survives the trip from the service, through the generated router
 * and the framework's own JSON serialization, into the generated SDK.
 *
 * The router used to write `ctx.body = result`, so Koa's `JSON.stringify` called `DateTime.toJSON()`
 * and sent a full ISO timestamp, and the SDK's `DateTime.fromFormat(v, 'yyyy-MM-dd')` rejected it:
 * the whole call failed with "does not match format yyyy-MM-dd".
 *
 * These tests run what the plugin emits. A small loader evaluates the emitted server types, router,
 * SDK types and SDK client together, with stand-ins for luxon and ServerKit, which this package does
 * not install, and real zod. The SDK's fetch hands each request to the router's own handler and
 * answers with what the framework would send: the body a Koa `ctx.body` or a Fastify `reply.send`
 * holds, stringified the way each framework stringifies an object.
 */

// ─── luxon stand-in ────────────────────────────────────────────────────────

const TOKENS = /yyyy|MM|dd|HH|mm|ss/g;
type Parts = Record<'yyyy' | 'MM' | 'dd' | 'HH' | 'mm' | 'ss', number>;

/**
 * A luxon `DateTime` in the respects under test: `fromFormat` is valid only for text in exactly that
 * format, `toFormat` writes one, `toJSON` is the full ISO timestamp luxon's is, and the instance
 * carries the `isLuxonDateTime` flag `DateTime.isDateTime` reads.
 */
class DateTime {
    readonly isLuxonDateTime = true;
    constructor(
        readonly parts: Parts,
        readonly isValid = true,
    ) {}

    static fromFormat(text: string, fmt: string): DateTime {
        const keys: (keyof Parts)[] = [];
        const pattern = fmt.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(TOKENS, token => {
            keys.push(token as keyof Parts);
            return token === 'yyyy' ? '(\\d{4})' : '(\\d{2})';
        });
        const match = new RegExp(`^${pattern}$`).exec(text);
        const parts: Parts = { yyyy: 1970, MM: 1, dd: 1, HH: 0, mm: 0, ss: 0 };
        if (!match) return new DateTime(parts, false);
        keys.forEach((key, i) => (parts[key] = Number(match[i + 1])));
        return new DateTime(parts);
    }

    toFormat(fmt: string): string {
        return fmt.replace(TOKENS, token => String(this.parts[token as keyof Parts]).padStart(token === 'yyyy' ? 4 : 2, '0'));
    }

    toJSON(): string {
        return `${this.toFormat('yyyy-MM-dd')}T${this.toFormat('HH:mm:ss')}.000Z`;
    }

    toString(): string {
        return this.toJSON();
    }
}

// ─── The contract under test ───────────────────────────────────────────────

const SOURCE = `
contract Release: {
    version: string
    date: date
    at: time("HH:mm")
    announced: date("MM/dd/yyyy")
    notes?: readonly date
}

operation /releases: {
    get: {
        sdk: listReleases
        service: ReleaseService.list
        response: {
            200: { application/json: array(Release) }
        }
    }
}

operation /releases/latest: {
    get: {
        sdk: latestRelease
        service: ReleaseService.latest
        response: {
            200: {
                headers: {
                    x-day: date
                }
                application/json: Release
            }
        }
    }
}

operation /releases/summary: {
    get: {
        sdk: releaseSummary
        service: ReleaseService.summary
        response: {
            200: { application/json: { since: date, latest: Release } }
        }
    }
}
`;

const release = (version: string, day: string) => ({
    version,
    date: DateTime.fromFormat(day, 'yyyy-MM-dd'),
    at: DateTime.fromFormat('09:30', 'HH:mm'),
    announced: DateTime.fromFormat('09/01/2026', 'MM/dd/yyyy'),
});

/** The service behind {@link SOURCE}, one method per operation, and the release it returns as latest. */
function makeService() {
    const latest = release('1.2.0', '2026-09-23');
    const older = release('1.1.0', '2026-08-01');
    const methods = {
        list: async () => [latest, older],
        latest: async () => ({ body: latest, headers: { xDay: latest.date } }),
        summary: async () => ({ since: DateTime.fromFormat('2026-01-01', 'yyyy-MM-dd'), latest }),
    };
    return { latest, methods };
}

// ─── Running the emitted files ─────────────────────────────────────────────

type Framework = 'koa' | 'fastify';
type Handler = (...args: unknown[]) => Promise<unknown>;
interface Route {
    method: string;
    path: string;
    handler: Handler;
}

/** Everything the plugin emits for {@link SOURCE}, keyed by absolute path. */
async function emit(framework: Framework, sdkZod: boolean): Promise<Map<string, string>> {
    const diag = new DiagnosticCollector();
    const { contract, op } = decomposeCk(parseCk(SOURCE, '/project/contracts/releases.ck', diag));
    expect(diag.getAll().filter(d => d.severity === 'error')).toEqual([]);
    const plugin = createTypescriptPlugin(
        {
            server: { framework, zod: true, output: { routes: 'server/routes/{filename}.router.ts', types: 'server/types/{filename}.ts' } },
            sdk: { zod: sdkZod, output: { sdk: 'sdk/sdk.ts', types: 'sdk/types/{filename}.ts', clients: 'sdk/clients/{filename}.client.ts' } },
        },
        '/project',
    );
    const emitted = new Map<string, string>();
    await plugin.generateTargets!(
        {
            contractRoots: [contract],
            opRoots: [op],
            modelOutPaths: new Map(),
            modelsWithInput: computeModelsWithInput(contract.models),
            modelsWithOutput: computeModelsWithOutput(contract.models),
        },
        {
            rootDir: '/project',
            options: {},
            cacheEnabled: false,
            cacheDir: '/project/.contractkit/cache',
            emitFile: (path: string, content: string) => emitted.set(path, content),
            warn: () => {},
        },
    );
    return emitted;
}

/** A CommonJS loader over the emitted files, with every package they import stood in for. */
function loader(files: Map<string, string>, routes: Route[]) {
    const record =
        (method: string) =>
        (path: string, ...rest: unknown[]) =>
            routes.push({ method, path, handler: rest[rest.length - 1] as Handler });
    const router = () => ({ get: record('get'), post: record('post'), put: record('put'), patch: record('patch'), delete: record('delete') });
    const services = { ReleaseService: class {} };
    const externals: Record<string, unknown> = {
        zod: { z },
        luxon: { DateTime },
        '@maroonedsoftware/koa': { ServerKitRouter: router, requirePolicy: () => async () => {}, bodyParserMiddleware: () => async () => {} },
        '@maroonedsoftware/fastify': { requirePolicy: () => async () => {} },
        '@maroonedsoftware/zod': { parseAndValidate: async (value: unknown, schema: z.ZodType) => schema.parse(value) },
        '@maroonedsoftware/utilities': { bigIntReplacer: (_: string, v: unknown) => v },
    };
    const cache = new Map<string, Record<string, unknown>>();
    const load = (path: string): Record<string, unknown> => {
        const cached = cache.get(path);
        if (cached) return cached;
        const source = files.get(path);
        expect(source, `nothing emitted at ${path}`).toBeDefined();
        const js = ts.transpileModule(source!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        const module = { exports: {} as Record<string, unknown> };
        cache.set(path, module.exports);
        const require = (spec: string): unknown => {
            if (spec.startsWith('.')) return load(join(dirname(path), spec.replace(/\.js$/, '.ts')));
            if (spec in externals) return externals[spec];
            if (/service/.test(spec)) return services;
            throw new Error(`unexpected import '${spec}' from ${path}`);
        };
        new Function('require', 'exports', 'module', js)(require, module.exports, module);
        return module.exports;
    };
    return load;
}

/**
 * Invoke the route matching `method` and `url` the way its framework would, and answer with the
 * response it would send. Both frameworks stringify an object body with plain `JSON.stringify`.
 */
async function dispatch(framework: Framework, routes: Route[], service: object, method: string, url: string): Promise<Response> {
    const route = routes.find(r => r.method === method && r.path === url);
    expect(route, `no ${method} ${url} among ${routes.map(r => `${r.method} ${r.path}`).join(', ')}`).toBeDefined();
    const headers: Record<string, string> = {};
    const container = { get: () => service };
    const text = (body: unknown) => (typeof body === 'string' ? body : JSON.stringify(body));

    if (framework === 'koa') {
        const ctx = {
            params: {},
            query: {},
            headers: {},
            container,
            status: 404,
            type: '',
            body: undefined as unknown,
            set: (k: string, v: string) => (headers[k] = v),
        };
        await route!.handler(ctx);
        return new Response(text(ctx.body), { status: ctx.status, headers: { ...headers, 'content-type': ctx.type } });
    }

    let status = 200;
    let serializer: ((payload: unknown) => string) | undefined;
    let sent: unknown;
    const reply = {
        status: (s: number) => ((status = s), reply),
        type: (t: string) => ((headers['content-type'] = t), reply),
        header: (k: string, v: string) => ((headers[k] = v), reply),
        serializer: (fn: (payload: unknown) => string) => ((serializer = fn), reply),
        send: (payload: unknown) => ((sent = payload), reply),
    };
    await route!.handler({ params: {}, query: {}, headers: {}, container }, reply);
    return new Response(serializer ? serializer(sent) : text(sent), { status, headers });
}

/** The generated SDK client for {@link SOURCE}, talking to the generated router in process. */
async function harness(framework: Framework, sdkZod: boolean) {
    const files = await emit(framework, sdkZod);
    const service = makeService();
    const routes: Route[] = [];
    const load = loader(files, routes);

    const routerModule = load('/project/server/routes/releases.router.ts');
    if (framework === 'fastify') {
        const plugin = Object.values(routerModule).find(v => typeof v === 'function') as (app: unknown) => Promise<void>;
        const record =
            (method: string) =>
            (path: string, ...rest: unknown[]) =>
                routes.push({ method, path, handler: rest[rest.length - 1] as Handler });
        await plugin({ get: record('get'), post: record('post'), put: record('put'), patch: record('patch'), delete: record('delete') });
    }

    const clientModule = load('/project/sdk/clients/releases.client.ts');
    const Client = Object.values(clientModule).find(v => typeof v === 'function' && /Client$/.test((v as { name: string }).name)) as new (
        fetch: (url: string, init: RequestInit) => Promise<Response>,
    ) => Record<string, () => Promise<unknown>>;
    const client = new Client((url, init) => dispatch(framework, routes, service.methods, (init.method ?? 'GET').toLowerCase(), url));
    return { files, service, client, load };
}

const formatted = (dt: unknown) => (dt as DateTime).toFormat('yyyy-MM-dd HH:mm:ss');

describe.each([
    ['koa', false],
    ['koa', true],
    ['fastify', false],
    ['fastify', true],
] as const)('a date response field round-trips (%s router, zod SDK: %s)', (framework, sdkZod) => {
    it('revives every date and time in an array of models, in each field’s own format', async () => {
        const { client, service } = await harness(framework, sdkZod);
        const releases = (await client.listReleases!()) as Record<string, unknown>[];
        expect(releases).toHaveLength(2);
        const [latest] = releases;
        expect(latest!.date).toBeInstanceOf(DateTime);
        expect((latest!.date as DateTime).isValid).toBe(true);
        expect(formatted(latest!.date)).toBe(formatted(service.latest.date));
        expect((latest!.at as DateTime).toFormat('HH:mm')).toBe('09:30');
        expect((latest!.announced as DateTime).toFormat('MM/dd/yyyy')).toBe('09/01/2026');
        expect(latest!.version).toBe('1.2.0');
    });

    it('revives the body and a date response header of a status that declares headers', async () => {
        const { client } = await harness(framework, sdkZod);
        const { data, headers } = (await client.latestRelease!()) as { data: Record<string, unknown>; headers: { xDay: DateTime } };
        expect((data.date as DateTime).toFormat('yyyy-MM-dd')).toBe('2026-09-23');
        expect(headers.xDay.isValid).toBe(true);
        expect(headers.xDay.toFormat('yyyy-MM-dd')).toBe('2026-09-23');
    });

    it('revives an inline body, through the wrapper the router declares for it', async () => {
        const { client, files } = await harness(framework, sdkZod);
        const summary = (await client.releaseSummary!()) as { since: DateTime; latest: Record<string, unknown> };
        expect(summary.since.toFormat('yyyy-MM-dd')).toBe('2026-01-01');
        expect((summary.latest.date as DateTime).toFormat('yyyy-MM-dd')).toBe('2026-09-23');
        expect(files.get('/project/server/routes/releases.router.ts')).toContain('function __serializeSummary200(value: unknown): unknown {');
    });

    it('leaves the objects the service returned as they were', async () => {
        const { client, service } = await harness(framework, sdkZod);
        await client.listReleases!();
        expect(service.latest.date).toBeInstanceOf(DateTime);
        expect(service.latest.at).toBeInstanceOf(DateTime);
    });
});

describe('the bug this closes', () => {
    it('the SDK rejects what the framework writes for a DateTime the router has not serialized', async () => {
        const { load } = await harness('koa', false);
        const { reviveRelease } = load('/project/sdk/types/releases.ts') as { reviveRelease: (raw: unknown) => unknown };
        const raw = JSON.parse(JSON.stringify(release('1.2.0', '2026-09-23')));
        expect(raw.date).toBe('2026-09-23T00:00:00.000Z');
        expect(() => reviveRelease(raw)).toThrow("'2026-09-23T00:00:00.000Z' at 'Release.date' does not match format yyyy-MM-dd.");
    });

    it('the router writes the body through the serializer the server types file declares', async () => {
        const { files } = await harness('koa', false);
        const router = files.get('/project/server/routes/releases.router.ts')!;
        expect(router).toContain('ctx.body = result.map(serializeRelease);');
        expect(router).toContain('ctx.body = serializeRelease(result.body);');
        expect(router).toContain(`ctx.set('x-day', result.headers["xDay"].toFormat('yyyy-MM-dd'));`);
    });
});
