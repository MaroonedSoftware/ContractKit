import { describe, it, expect } from 'vitest';
import { buildDocsJson, renderDocsJson, resolveSiteName } from '../../../src/targets/mintlify/docs-json.js';
import { groupEndpoints } from '../../../src/naming.js';
import { model, opOperation, opRoute, opRoot } from '../../helpers.js';
import type { DocsJsonContext, NavGroup, NavTab } from '../../../src/targets/mintlify/docs-json.js';
import type { DocsPluginConfig } from '../../../src/target.js';

const groups = groupEndpoints([opRoot([opRoute('/invoices', [opOperation('get', { name: 'listInvoices' })])], 'invoices.op', { area: 'billing' })]);

const models = [{ model: model('User', []), title: 'User', slug: 'user' }];

function ctxWith(config: DocsPluginConfig, overrides: Partial<DocsJsonContext> = {}): DocsJsonContext {
    return { config, apiDir: 'api-reference', modelsDir: 'api-reference/models', groups, models, hasIndex: true, ...overrides };
}

/** The generated tab, which is always the last one. */
function generatedTab(doc: Record<string, unknown>): NavTab {
    const nav = doc.navigation as { tabs: NavTab[] };
    return nav.tabs[nav.tabs.length - 1]!;
}

describe('resolveSiteName', () => {
    it('prefers an explicit docs.name', () => {
        expect(resolveSiteName({ docs: { name: 'Acme Docs' }, openapi: { info: { title: 'Acme API' } } })).toBe('Acme Docs');
    });

    it('falls back to the OpenAPI title', () => {
        expect(resolveSiteName({ openapi: { info: { title: 'Acme API' } } })).toBe('Acme API');
    });

    it('falls back to API when nothing is configured', () => {
        expect(resolveSiteName({})).toBe('API');
    });
});

describe('buildDocsJson defaults', () => {
    const doc = buildDocsJson(ctxWith({}));

    it('sets the schema URL so editors validate the file', () => {
        expect(doc.$schema).toBe('https://mintlify.com/docs.json');
    });

    it('sets the four keys Mintlify requires', () => {
        expect(doc).toHaveProperty('name');
        expect(doc).toHaveProperty('theme', 'mint');
        expect(doc.colors).toEqual({ primary: '#0D9373' });
        expect(doc).toHaveProperty('navigation');
    });
});

describe('generated navigation', () => {
    it('puts the generated groups in an API Reference tab', () => {
        expect(generatedTab(buildDocsJson(ctxWith({}))).tab).toBe('API Reference');
    });

    it('honours a custom tab name', () => {
        expect(generatedTab(buildDocsJson(ctxWith({ tab: 'Reference' }))).tab).toBe('Reference');
    });

    it('orders Overview, then endpoint areas, then Models', () => {
        expect(generatedTab(buildDocsJson(ctxWith({}))).groups.map(g => g.group)).toEqual(['Overview', 'Billing', 'Models']);
    });

    it('lists endpoint pages by their full docs-root-relative path', () => {
        const billing = generatedTab(buildDocsJson(ctxWith({}))).groups.find(g => g.group === 'Billing');
        expect(billing!.pages).toEqual(['api-reference/billing/list-invoices']);
    });

    it('lists model pages under the models directory', () => {
        const modelGroup = generatedTab(buildDocsJson(ctxWith({}))).groups.find(g => g.group === 'Models');
        expect(modelGroup!.pages).toEqual(['api-reference/models/user']);
    });

    it('respects custom directories', () => {
        const doc = buildDocsJson(ctxWith({}, { apiDir: 'reference', modelsDir: 'schemas' }));
        const names = generatedTab(doc).groups.flatMap(g => g.pages);
        expect(names).toEqual(['index', 'reference/billing/list-invoices', 'schemas/user']);
    });

    it('omits the Overview group when there is no index page', () => {
        const doc = buildDocsJson(ctxWith({}, { hasIndex: false }));
        expect(generatedTab(doc).groups.map(g => g.group)).toEqual(['Billing', 'Models']);
    });

    it('omits the Models group when there are no model pages', () => {
        const doc = buildDocsJson(ctxWith({}, { models: [] }));
        expect(generatedTab(doc).groups.map(g => g.group)).toEqual(['Overview', 'Billing']);
    });

    it('omits an endpoint group that ended up empty', () => {
        const empty = [{ area: 'billing', title: 'Billing', slug: 'billing', endpoints: [] }];
        const doc = buildDocsJson(ctxWith({}, { groups: empty }));
        expect(generatedTab(doc).groups.map(g => g.group)).toEqual(['Overview', 'Models']);
    });
});

describe('tab: false', () => {
    it('puts the generated groups directly under navigation.groups', () => {
        const nav = buildDocsJson(ctxWith({ tab: false })).navigation as { groups: NavGroup[]; tabs?: unknown };
        expect(nav.groups.map(g => g.group)).toEqual(['Overview', 'Billing', 'Models']);
        expect(nav.tabs).toBeUndefined();
    });

    it('appends after any groups the user configured', () => {
        const config: DocsPluginConfig = { tab: false, docs: { navigation: { groups: [{ group: 'Guides', pages: ['guides/start'] }] } } };
        const nav = buildDocsJson(ctxWith(config)).navigation as { groups: NavGroup[] };
        expect(nav.groups.map(g => g.group)).toEqual(['Guides', 'Overview', 'Billing', 'Models']);
    });
});

describe('user config merge', () => {
    it('overrides the generated theme, name and colors', () => {
        const doc = buildDocsJson(ctxWith({ docs: { theme: 'maple', name: 'Acme', colors: { primary: '#FF0000' } } }));
        expect(doc.theme).toBe('maple');
        expect(doc.name).toBe('Acme');
        expect(doc.colors).toEqual({ primary: '#FF0000' });
    });

    it('passes through keys the plugin knows nothing about', () => {
        const doc = buildDocsJson(ctxWith({ docs: { logo: '/logo.svg', favicon: '/favicon.ico' } }));
        expect(doc.logo).toBe('/logo.svg');
        expect(doc.favicon).toBe('/favicon.ico');
    });

    it('appends the generated tab after user tabs rather than replacing them', () => {
        const config: DocsPluginConfig = { docs: { navigation: { tabs: [{ tab: 'Guides', groups: [] }] } } };
        const nav = buildDocsJson(ctxWith(config)).navigation as { tabs: NavTab[] };
        expect(nav.tabs.map(t => t.tab)).toEqual(['Guides', 'API Reference']);
    });

    it('keeps other navigation keys such as global anchors', () => {
        const anchors = { anchors: [{ anchor: 'Blog', href: 'https://example.com' }] };
        const config: DocsPluginConfig = { docs: { navigation: { global: anchors } } };
        const nav = buildDocsJson(ctxWith(config)).navigation as { global: unknown; tabs: NavTab[] };
        expect(nav.global).toEqual(anchors);
        expect(nav.tabs).toHaveLength(1);
    });

    it('cannot have navigation replaced wholesale, which would drop the generated pages', () => {
        const config: DocsPluginConfig = { docs: { navigation: { tabs: [] } } };
        expect(generatedTab(buildDocsJson(ctxWith(config))).groups.length).toBeGreaterThan(0);
    });
});

describe('renderDocsJson', () => {
    it('serializes with four-space indent and a trailing newline', () => {
        const out = renderDocsJson(ctxWith({}));
        expect(out.startsWith('{\n    "$schema"')).toBe(true);
        expect(out.endsWith('}\n')).toBe(true);
    });

    it('round-trips as valid JSON', () => {
        expect(JSON.parse(renderDocsJson(ctxWith({})))).toHaveProperty('navigation');
    });
});
