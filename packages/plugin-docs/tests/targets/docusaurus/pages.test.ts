import { describe, it, expect } from 'vitest';
import { docusaurusDialect, renderEndpointPage, renderIndexPage, renderModelPage } from '../../../src/targets/docusaurus/pages.js';
import { groupEndpoints } from '../../../src/naming.js';
import { field, model, opOperation, opResponse, opRoute, opRoot, refType, scalarType } from '../../helpers.js';
import type { ModelPages } from '../../../src/targets/docusaurus/pages.js';
import type { EndpointEntry, ModelEntry } from '../../../src/naming.js';

const MODEL_PAGES: ModelPages = new Map([
    ['User', 'api-reference/models/user'],
    ['Invoice', 'api-reference/models/billing/invoice'],
]);

/** Build the single endpoint entry produced by one route/operation pair. */
function entryFor(route: ReturnType<typeof opRoute>): EndpointEntry {
    return groupEndpoints([opRoot([route])])[0]!.endpoints[0]!;
}

function endpointPage(route: ReturnType<typeof opRoute>, fromDir = 'api-reference/endpoints'): string {
    return renderEndpointPage(entryFor(route), { position: 1, fromDir, modelPages: MODEL_PAGES, modelIndex: new Map() });
}

function modelEntry(m: ReturnType<typeof model>, slug = 'admin'): ModelEntry {
    return { model: m, title: m.name, slug };
}

describe('docusaurusDialect', () => {
    it('renders an untitled callout as a fenced admonition', () => {
        expect(docusaurusDialect('a', MODEL_PAGES).admonition({ kind: 'note', lines: ['One', 'Two'] })).toEqual([':::note', 'One', 'Two', ':::']);
    });

    it('puts a title in the admonition head, where Docusaurus reads it', () => {
        expect(docusaurusDialect('a', MODEL_PAGES).admonition({ kind: 'warning', title: 'Deprecated', lines: ['Gone soon.'] })).toEqual([
            ':::warning[Deprecated]',
            'Gone soon.',
            ':::',
        ]);
    });

    it('links up out of an endpoint folder into the models folder', () => {
        expect(docusaurusDialect('api-reference/endpoints', MODEL_PAGES).modelLink('User')).toBe('../models/user.md');
    });

    it('keeps an explicit ./ for a sibling page, which Docusaurus would otherwise read as a doc id', () => {
        expect(docusaurusDialect('api-reference/models', MODEL_PAGES).modelLink('User')).toBe('./user.md');
    });

    it('links across model areas', () => {
        expect(docusaurusDialect('api-reference/models/billing', MODEL_PAGES).modelLink('User')).toBe('../user.md');
    });

    it('has no link for a model with no page', () => {
        expect(docusaurusDialect('api-reference/endpoints', MODEL_PAGES).modelLink('Ghost')).toBeUndefined();
    });
});

describe('renderEndpointPage', () => {
    it('opts the page into CommonMark, so the raw HTML in the body survives', () => {
        expect(endpointPage(opRoute('/users', [opOperation('get', { name: 'listUsers' })]))).toContain('mdx:\n    format: "md"');
    });

    it('writes the title, sidebar label and position', () => {
        const out = endpointPage(opRoute('/users', [opOperation('get', { name: 'listUsers' })]));
        expect(out).toContain('title: "List users"');
        expect(out).toContain('sidebar_label: "List users"');
        expect(out).toContain('sidebar_position: 1');
    });

    it('has no heading of its own — Docusaurus renders the title frontmatter as the H1', () => {
        const out = endpointPage(opRoute('/users', [opOperation('get', { name: 'listUsers' })]));
        expect(out).not.toContain('# List users');
    });

    it('renders the method and path', () => {
        expect(endpointPage(opRoute('/users/{id}', [opOperation('delete', {})]))).toContain('**`DELETE`** `/users/{id}`');
    });

    it('renders subsections at level two, under the page title', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'listUsers', responses: [opResponse(200, refType('User'))] })]);
        expect(endpointPage(route)).toContain('## Response');
    });

    it('links a response model to its page', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'listUsers', responses: [opResponse(200, refType('User'))] })]);
        expect(endpointPage(route)).toContain('Returns a [User](../models/user.md) object.');
    });

    it('renders a model with no page as plain code', () => {
        const route = opRoute('/things', [opOperation('get', { name: 'listThings', responses: [opResponse(200, refType('Ghost'))] })]);
        expect(endpointPage(route)).toContain('Returns a `Ghost` object.');
    });

    it('leads with the description when the title came from the name', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'listUsers', description: 'Returns every user.' })]);
        const out = endpointPage(route);
        expect(out).toContain('title: "List users"');
        expect(out).toContain('\nReturns every user.\n');
    });

    it('omits the description when it is already the title', () => {
        // `deriveTitle` promotes the description to the title, in the imperative mood.
        const route = opRoute('/users', [opOperation('get', { description: 'Returns every user.' })]);
        const out = endpointPage(route);
        expect(out).toContain('title: "Return every user."');
        expect(out).not.toContain('Returns every user.');
    });

    it('renders a deprecated endpoint as a titled admonition', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'listUsers', modifiers: ['deprecated'] })]);
        const out = endpointPage(route);
        expect(out).toContain(':::warning[Deprecated]');
        expect(out).not.toContain('[!WARNING]');
    });

    it('renders the SDK note as an admonition', () => {
        const out = endpointPage(opRoute('/users', [opOperation('get', { name: 'listUsers' })]));
        expect(out).toContain(':::note\nSDK method: `getUsers`\n:::');
    });
});

describe('renderModelPage', () => {
    it('opts into CommonMark and titles the page', () => {
        const out = renderModelPage(modelEntry(model('User', [field('id', scalarType('uuid'))]), 'user'), {
            position: 2,
            fromDir: 'api-reference/models',
            modelPages: MODEL_PAGES,
        });
        expect(out).toContain('title: "User"');
        expect(out).toContain('sidebar_position: 2');
        expect(out).toContain('mdx:\n    format: "md"');
    });

    it('renders the field table', () => {
        const out = renderModelPage(modelEntry(model('User', [field('id', scalarType('uuid'))]), 'user'), {
            position: 1,
            fromDir: 'api-reference/models',
            modelPages: MODEL_PAGES,
        });
        expect(out).toContain('| Attribute | Type | Required | Description |');
        expect(out).toContain('| `id` | `string` | Yes |  |');
    });

    it('links a base model to its page', () => {
        const admin = model('Admin', [field('role', scalarType('string'))], { bases: ['User'] });
        const out = renderModelPage(modelEntry(admin), { position: 1, fromDir: 'api-reference/models', modelPages: MODEL_PAGES });
        expect(out).toContain('Extends [`User`](./user.md)');
    });

    it('renders a deprecated model as a titled admonition', () => {
        const out = renderModelPage(modelEntry(model('Old', [], { deprecated: true }), 'old'), {
            position: 1,
            fromDir: 'api-reference/models',
            modelPages: MODEL_PAGES,
        });
        expect(out).toContain(':::warning[Deprecated]');
    });
});

describe('renderIndexPage', () => {
    it('is titled with the section label and sorts first', () => {
        const out = renderIndexPage('API Reference');
        expect(out).toContain('title: "API Reference"');
        expect(out).toContain('sidebar_position: 0');
    });

    it('says the page is user-owned', () => {
        expect(renderIndexPage('API Reference')).toContain('never overwritten');
    });
});
