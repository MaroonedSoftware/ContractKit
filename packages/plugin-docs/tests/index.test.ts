import { describe, it, expect } from 'vitest';
import plugin, { createDocsPlugin } from '../src/index.js';
import { contractRoot, field, model, opOperation, opRequest, opResponse, opRoute, opRoot, refType, scalarType } from './helpers.js';
import type { ContractKitPlugin, PluginContext } from '@contractkit/core';
import type { MintlifyConfig } from '../src/target.js';

const ROOT_DIR = '/project';

/** In-memory `PluginContext`, keyed by rootDir-relative POSIX path. */
function makeCtx(options: Record<string, unknown> = {}): PluginContext & {
    emitted: Map<string, string>;
    ifAbsent: Set<string>;
} {
    const emitted = new Map<string, string>();
    const ifAbsent = new Set<string>();
    return {
        rootDir: ROOT_DIR,
        options,
        cacheEnabled: false,
        cacheDir: '/tmp/ck-docs-test',
        emitFile: (outPath, content, opts) => {
            const rel = outPath.replace(`${ROOT_DIR}/`, '');
            emitted.set(rel, content);
            if (opts?.ifAbsent) ifAbsent.add(rel);
        },
        emitted,
        ifAbsent,
    };
}

const contractRoots = [
    contractRoot([
        model('User', [field('id', scalarType('string')), field('name', scalarType('string'))]),
        model('Unused', [field('x', scalarType('string'))]),
    ]),
];

const opRoots = [
    opRoot([
        opRoute('/users', [
            opOperation('get', { name: 'listUsers', responses: [opResponse(200, refType('User'))] }),
            opOperation('post', { name: 'createUser', request: opRequest('User'), responses: [opResponse(201, refType('User'))] }),
        ]),
        opRoute('/internal/stats', [opOperation('get', { modifiers: ['internal'], responses: [opResponse(200, refType('User'))] })]),
    ]),
];

const inputs = { contractRoots, opRoots, modelsWithInput: new Set<string>(), modelsWithOutput: new Set<string>() };

/** Run a plugin over the shared fixtures and return what it emitted. */
async function run(p: ContractKitPlugin, mintlifyOptions: Record<string, unknown> = {}): Promise<Map<string, string>> {
    const ctx = makeCtx({ mintlify: mintlifyOptions });
    await p.generateTargets!(inputs, ctx);
    return ctx.emitted;
}

describe('plugin shell', () => {
    it('is named docs', () => {
        expect(plugin.name).toBe('docs');
        expect(createDocsPlugin({ mintlify: {} }, ROOT_DIR).name).toBe('docs');
    });

    it('folds the config into the factory cache key so a config change busts the cache', () => {
        const a = createDocsPlugin({ mintlify: { baseDir: 'docs' } }, ROOT_DIR).cacheKey;
        const b = createDocsPlugin({ mintlify: { baseDir: 'site' } }, ROOT_DIR).cacheKey;
        expect(a).not.toBe(b);
    });

    it('runs the mintlify target when its sub-config is present', async () => {
        const emitted = await run(plugin);
        expect([...emitted.keys()]).toContain('docs/openapi.yaml');
    });

    it('fails when no target is configured rather than emitting nothing', async () => {
        const ctx = makeCtx({});
        await expect(plugin.generateTargets!(inputs, ctx)).rejects.toThrow(/no target configured.*mintlify/);
    });

    it('reads config from ctx.options for the default export', async () => {
        const emitted = await run(plugin, { baseDir: 'site' });
        expect([...emitted.keys()]).toContain('site/openapi.yaml');
    });

    it('reads config from the factory argument, ignoring ctx.options', async () => {
        const ctx = makeCtx({ mintlify: { baseDir: 'ignored' } });
        await createDocsPlugin({ mintlify: { baseDir: 'site' } }, ROOT_DIR).generateTargets!(inputs, ctx);
        expect([...ctx.emitted.keys()]).toContain('site/openapi.yaml');
    });
});

describe('emitted file set', () => {
    it('emits a spec plus one page per public endpoint and reachable model', async () => {
        const emitted = await run(plugin);
        expect([...emitted.keys()].sort()).toEqual([
            'docs/api-reference/endpoints/create-user.mdx',
            'docs/api-reference/endpoints/list-users.mdx',
            'docs/api-reference/models/user.mdx',
            'docs/docs.json',
            'docs/index.mdx',
            'docs/openapi.yaml',
        ]);
    });

    it('groups endpoint pages under the area directory', async () => {
        const areaRoots = [opRoot([opRoute('/invoices', [opOperation('get', { name: 'listInvoices' })])], 'invoices.op', { area: 'billing' })];
        const ctx = makeCtx({ mintlify: {} });
        await plugin.generateTargets!({ ...inputs, opRoots: areaRoots }, ctx);
        expect([...ctx.emitted.keys()]).toContain('docs/api-reference/billing/list-invoices.mdx');
    });

    it('omits internal endpoints', async () => {
        const emitted = await run(plugin);
        expect([...emitted.keys()].some(k => k.includes('stats'))).toBe(false);
    });

    it('includes internal endpoints when asked', async () => {
        const emitted = await run(plugin, { includeInternal: true });
        expect([...emitted.keys()]).toContain('docs/api-reference/endpoints/get-internal-stats.mdx');
    });

    it('omits models no endpoint can reach', async () => {
        const emitted = await run(plugin);
        expect([...emitted.keys()].some(k => k.includes('unused'))).toBe(false);
    });

    it('skips model pages when modelPages is false', async () => {
        const emitted = await run(plugin, { modelPages: false });
        expect([...emitted.keys()].some(k => k.includes('/models/'))).toBe(false);
    });

    it('honours custom api and model directories', async () => {
        const emitted = await run(plugin, { apiDir: 'reference', modelsDir: 'schemas' });
        expect([...emitted.keys()].sort()).toContain('docs/reference/endpoints/list-users.mdx');
        expect([...emitted.keys()].sort()).toContain('docs/schemas/user.mdx');
    });
});

describe('docs.json', () => {
    it('lists every emitted page and nothing else', async () => {
        const emitted = await run(plugin);
        type NavNode = string | { pages: NavNode[] };
        const flatten = (nodes: NavNode[]): string[] => nodes.flatMap(n => (typeof n === 'string' ? [n] : flatten(n.pages)));
        const nav = JSON.parse(emitted.get('docs/docs.json')!).navigation as { tabs: { groups: { pages: NavNode[] }[] }[] };
        const listed = nav.tabs.flatMap(t => flatten(t.groups.flatMap(g => g.pages))).sort();
        const pages = [...emitted.keys()]
            .filter(k => k.endsWith('.mdx'))
            .map(k => k.replace(/^docs\//, '').replace(/\.mdx$/, ''))
            .sort();
        expect(listed).toEqual(pages);
    });

    it('names the site from the OpenAPI title', async () => {
        const emitted = await run(plugin, { openapi: { info: { title: 'Acme API', version: '1.0.0' } } });
        expect(JSON.parse(emitted.get('docs/docs.json')!).name).toBe('Acme API');
    });

    it('nests model pages by area, in the navigation and on disk', async () => {
        const areaContracts = [contractRoot([model('User', [field('id', scalarType('string'))])], 'identity.ck', { area: 'identity' })];
        const ctx = makeCtx({ mintlify: {} });
        await plugin.generateTargets!({ ...inputs, contractRoots: areaContracts }, ctx);

        expect([...ctx.emitted.keys()]).toContain('docs/api-reference/models/identity/user.mdx');

        const nav = JSON.parse(ctx.emitted.get('docs/docs.json')!).navigation as { tabs: { groups: { group: string; pages: unknown[] }[] }[] };
        const modelsGroup = nav.tabs[0]!.groups.find(g => g.group === 'Models')!;
        expect(modelsGroup.pages).toEqual([{ group: 'Identity', pages: ['api-reference/models/identity/user'] }]);
    });

    it('drops the Models group when model pages are off', async () => {
        const emitted = await run(plugin, { modelPages: false });
        const nav = JSON.parse(emitted.get('docs/docs.json')!).navigation as { tabs: { groups: { group: string }[] }[] };
        expect(nav.tabs[0]!.groups.map(g => g.group)).not.toContain('Models');
    });
});

describe('index page', () => {
    it('is written once and never overwritten', async () => {
        const ctx = makeCtx({ mintlify: {} });
        await plugin.generateTargets!(inputs, ctx);
        expect(ctx.ifAbsent.has('docs/index.mdx')).toBe(true);
    });

    it('is the only user-owned file — generated pages must stay in sync', async () => {
        const ctx = makeCtx({ mintlify: {} });
        await plugin.generateTargets!(inputs, ctx);
        expect([...ctx.ifAbsent]).toEqual(['docs/index.mdx']);
    });

    it('is titled with the site name', async () => {
        const emitted = await run(plugin, { openapi: { info: { title: 'Acme API', version: '1.0.0' } } });
        expect(emitted.get('docs/index.mdx')).toContain('title: "Acme API"');
    });
});

describe('openapi spec', () => {
    it('emits the spec at the configured filename and points pages at it', async () => {
        const emitted = await run(plugin, { openapi: { output: 'spec/api.yaml' } });
        expect([...emitted.keys()]).toContain('docs/spec/api.yaml');
        expect(emitted.get('docs/api-reference/endpoints/list-users.mdx')).toContain('openapi: "/spec/api.yaml GET /users"');
    });

    it('passes info through to the spec', async () => {
        const emitted = await run(plugin, { openapi: { info: { title: 'Acme API', version: '2.0.0' } } });
        expect(emitted.get('docs/openapi.yaml')).toContain("title: 'Acme API'");
    });

    it('ignores a baseDir inside the openapi config, which would strand every page reference', async () => {
        const emitted = await run(plugin, { openapi: { baseDir: 'elsewhere/' } as MintlifyConfig['openapi'] });
        expect([...emitted.keys()]).toContain('docs/openapi.yaml');
    });

    it('keeps internal operations out of the spec by default', async () => {
        const emitted = await run(plugin);
        expect(emitted.get('docs/openapi.yaml')).not.toContain('/internal/stats');
    });

    it('puts internal operations in the spec when includeInternal is set', async () => {
        const emitted = await run(plugin, { includeInternal: true });
        expect(emitted.get('docs/openapi.yaml')).toContain('/internal/stats');
    });

    it('emits security schemes when configured', async () => {
        const emitted = await run(plugin, {
            openapi: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
        });
        expect(emitted.get('docs/openapi.yaml')).toContain('securitySchemes:');
    });
});
