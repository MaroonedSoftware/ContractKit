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

/** Run a plugin over the shared fixtures with the mintlify target on, and return what it emitted. */
async function run(p: ContractKitPlugin, mintlifyOptions: Record<string, unknown> = {}): Promise<Map<string, string>> {
    return runWith(p, { mintlify: mintlifyOptions });
}

/** Run a plugin over the shared fixtures with a whole plugin config. */
async function runWith(p: ContractKitPlugin, options: Record<string, unknown>): Promise<Map<string, string>> {
    const ctx = makeCtx(options);
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
        await expect(plugin.generateTargets!(inputs, ctx)).rejects.toThrow(/no target configured.*mintlify.*docusaurus/);
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

describe('shared spec between the openapi and mintlify targets', () => {
    /** Run with both targets configured. */
    async function runBoth(mintlifyCfg: Record<string, unknown>, openapiCfg: Record<string, unknown>): Promise<Map<string, string>> {
        const ctx = makeCtx({ mintlify: mintlifyCfg, openapi: openapiCfg });
        await plugin.generateTargets!(inputs, ctx);
        return ctx.emitted;
    }

    it('emits one spec when the openapi target writes inside the docs folder', async () => {
        // A distinct filename, so a target that ignored the shared spec would leave two files
        // rather than colliding on one path and looking correct.
        const emitted = await runBoth({ baseDir: 'docs' }, { baseDir: 'docs', output: 'reference.yaml' });
        expect([...emitted.keys()].filter(k => k.endsWith('.yaml'))).toEqual(['docs/reference.yaml']);
    });

    it('points the pages at the shared spec', async () => {
        const emitted = await runBoth({ baseDir: 'docs' }, { baseDir: 'docs', output: 'spec/api.yaml' });
        expect([...emitted.keys()]).toContain('docs/spec/api.yaml');
        expect(emitted.get('docs/api-reference/endpoints/list-users.mdx')).toContain('openapi: "/spec/api.yaml GET /users"');
    });

    it('emits its own copy when the openapi target writes outside the docs folder', async () => {
        const emitted = await runBoth({ baseDir: 'docs' }, { baseDir: 'build', output: 'openapi.yaml' });
        const specs = [...emitted.keys()].filter(k => k.endsWith('.yaml')).sort();
        expect(specs).toEqual(['build/openapi.yaml', 'docs/openapi.yaml']);
        expect(emitted.get('docs/api-reference/endpoints/list-users.mdx')).toContain('openapi: "/openapi.yaml GET /users"');
    });

    it('uses the openapi target settings for the shared document', async () => {
        const emitted = await runBoth({ baseDir: 'docs' }, { baseDir: 'docs', info: { title: 'Shared API', version: '3.0.0' } });
        expect(emitted.get('docs/openapi.yaml')).toContain("title: 'Shared API'");
    });

    it('still emits its own spec when only the mintlify target is configured', async () => {
        const emitted = await run(plugin, { baseDir: 'docs' });
        expect([...emitted.keys()].filter(k => k.endsWith('.yaml'))).toEqual(['docs/openapi.yaml']);
    });
});

describe('docusaurus target', () => {
    /** Run the docusaurus target alone and return what it emitted. */
    async function runDocs(options: Record<string, unknown> = {}): Promise<Map<string, string>> {
        return runWith(plugin, { docusaurus: options });
    }

    it('emits a page per public endpoint and reachable model, plus its categories', async () => {
        expect([...(await runDocs()).keys()].sort()).toEqual([
            'docs/api-reference/_category_.json',
            'docs/api-reference/endpoints/_category_.json',
            'docs/api-reference/endpoints/create-user.md',
            'docs/api-reference/endpoints/list-users.md',
            'docs/api-reference/index.md',
            'docs/api-reference/models/_category_.json',
            'docs/api-reference/models/user.md',
        ]);
    });

    it('emits no OpenAPI spec — the pages carry their own content', async () => {
        expect([...(await runDocs()).keys()].some(k => k.endsWith('.yaml'))).toBe(false);
    });

    it('honours a custom docs root', async () => {
        expect([...(await runDocs({ baseDir: 'site/docs' })).keys()]).toContain('site/docs/api-reference/index.md');
    });

    it('honours custom api and model directories', async () => {
        const emitted = await runDocs({ apiDir: 'reference', modelsDir: 'schemas' });
        expect([...emitted.keys()]).toContain('docs/reference/endpoints/list-users.md');
        expect([...emitted.keys()]).toContain('docs/schemas/user.md');
    });

    it('groups endpoint pages under the area directory', async () => {
        const areaRoots = [opRoot([opRoute('/invoices', [opOperation('get', { name: 'listInvoices' })])], 'invoices.op', { area: 'billing' })];
        const ctx = makeCtx({ docusaurus: {} });
        await plugin.generateTargets!({ ...inputs, opRoots: areaRoots }, ctx);
        expect([...ctx.emitted.keys()]).toContain('docs/api-reference/billing/list-invoices.md');
        expect(JSON.parse(ctx.emitted.get('docs/api-reference/billing/_category_.json')!).label).toBe('Billing');
    });

    it('nests model pages by area and links across areas', async () => {
        const areaContracts = [contractRoot([model('User', [field('id', scalarType('string'))])], 'identity.ck', { area: 'identity' })];
        const ctx = makeCtx({ docusaurus: {} });
        await plugin.generateTargets!({ ...inputs, contractRoots: areaContracts }, ctx);
        expect([...ctx.emitted.keys()]).toContain('docs/api-reference/models/identity/user.md');
        expect(ctx.emitted.get('docs/api-reference/endpoints/list-users.md')).toContain('../models/identity/user.md');
    });

    it('omits internal endpoints', async () => {
        expect([...(await runDocs()).keys()].some(k => k.includes('stats'))).toBe(false);
    });

    it('includes internal endpoints when asked', async () => {
        expect([...(await runDocs({ includeInternal: true })).keys()]).toContain('docs/api-reference/endpoints/get-internal-stats.md');
    });

    it('omits models no endpoint can reach', async () => {
        expect([...(await runDocs()).keys()].some(k => k.includes('unused'))).toBe(false);
    });

    it('skips model pages, and their category, when modelPages is false', async () => {
        const emitted = await runDocs({ modelPages: false });
        expect([...emitted.keys()].some(k => k.includes('/models'))).toBe(false);
    });

    it('renders an unlinkable model as plain code when model pages are off', async () => {
        const emitted = await runDocs({ modelPages: false });
        expect(emitted.get('docs/api-reference/endpoints/list-users.md')).toContain('Returns a `User` object.');
    });

    it('labels and positions the generated section', async () => {
        const emitted = await runDocs({ label: 'Acme API', position: 3 });
        expect(JSON.parse(emitted.get('docs/api-reference/_category_.json')!)).toEqual({ label: 'Acme API', position: 3 });
        expect(emitted.get('docs/api-reference/index.md')).toContain('title: "Acme API"');
    });

    it('leaves the section unpositioned by default', async () => {
        expect(JSON.parse((await runDocs()).get('docs/api-reference/_category_.json')!)).toEqual({ label: 'API Reference' });
    });

    it('sorts the Models category after every endpoint group', async () => {
        const areaRoots = [
            opRoot([opRoute('/invoices', [opOperation('get', { name: 'listInvoices', responses: [opResponse(200, refType('User'))] })])], 'a.op', {
                area: 'billing',
            }),
            opRoot([opRoute('/orgs', [opOperation('get', { name: 'listOrgs' })])], 'b.op', { area: 'identity' }),
        ];
        const ctx = makeCtx({ docusaurus: {} });
        await plugin.generateTargets!({ ...inputs, opRoots: areaRoots }, ctx);
        const positionOf = (path: string): number => JSON.parse(ctx.emitted.get(path)!).position as number;
        expect(positionOf('docs/api-reference/billing/_category_.json')).toBe(1);
        expect(positionOf('docs/api-reference/identity/_category_.json')).toBe(2);
        expect(positionOf('docs/api-reference/models/_category_.json')).toBe(3);
    });

    it('gives every generated category an explicit index link, so no page is swallowed as its landing doc', async () => {
        const emitted = await runDocs();
        expect(JSON.parse(emitted.get('docs/api-reference/endpoints/_category_.json')!).link.type).toBe('generated-index');
        expect(JSON.parse(emitted.get('docs/api-reference/models/_category_.json')!).link.type).toBe('generated-index');
    });

    it('leaves the section category without a link, so index.md becomes its landing page', async () => {
        expect(JSON.parse((await runDocs()).get('docs/api-reference/_category_.json')!).link).toBeUndefined();
    });

    it('numbers endpoint pages in contract order', async () => {
        const emitted = await runDocs();
        expect(emitted.get('docs/api-reference/endpoints/list-users.md')).toContain('sidebar_position: 1');
        expect(emitted.get('docs/api-reference/endpoints/create-user.md')).toContain('sidebar_position: 2');
    });

    it('owns nothing but the starter index page', async () => {
        const ctx = makeCtx({ docusaurus: {} });
        await plugin.generateTargets!(inputs, ctx);
        expect([...ctx.ifAbsent]).toEqual(['docs/api-reference/index.md']);
    });

    it('runs alongside another target', async () => {
        const emitted = await runWith(plugin, { docusaurus: { baseDir: 'site' }, markdown: { output: 'api.md' } });
        expect([...emitted.keys()]).toContain('site/api-reference/index.md');
        expect([...emitted.keys()]).toContain('api.md');
    });
});
