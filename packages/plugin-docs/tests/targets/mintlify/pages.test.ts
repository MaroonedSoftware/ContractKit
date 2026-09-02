import { describe, it, expect } from 'vitest';
import { renderEndpointPage, renderModelPage, renderIndexPage } from '../../../src/targets/mintlify/pages.js';
import { groupEndpoints } from '../../../src/naming.js';
import { field, model, opOperation, opRoute, opRoot, scalarType } from '../../helpers.js';
import type { EndpointEntry, ModelEntry } from '../../../src/naming.js';

/** Build the single endpoint entry produced by one route/operation pair. */
function entryFor(route: ReturnType<typeof opRoute>): EndpointEntry {
    return groupEndpoints([opRoot([route])])[0]!.endpoints[0]!;
}

describe('renderEndpointPage', () => {
    it('renders the frontmatter block a Mintlify endpoint page needs', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'listUsers' })]);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).toBe(
            ['---', 'title: "List Users"', 'sidebarTitle: "List Users"', 'openapi: "/openapi.yaml GET /users"', '---', ''].join('\n'),
        );
    });

    it('uppercases the HTTP method in the openapi reference', () => {
        const route = opRoute('/users/{id}', [opOperation('delete', {})]);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).toContain('openapi: "/openapi.yaml DELETE /users/{id}"');
    });

    it('keeps the path parameter braces the spec uses', () => {
        const route = opRoute('/orgs/{orgId}/users/{id}', [opOperation('get', {})]);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).toContain('GET /orgs/{orgId}/users/{id}"');
    });

    it('honours a custom spec path', () => {
        const route = opRoute('/users', [opOperation('get', {})]);
        expect(renderEndpointPage(entryFor(route), '/spec/api.yaml')).toContain('openapi: "/spec/api.yaml GET /users"');
    });

    it('has no body — the spec already carries the description Mintlify renders', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'listUsers', description: 'Returns every user.' })]);
        const out = renderEndpointPage(entryFor(route), '/openapi.yaml');
        expect(out.endsWith('---\n')).toBe(true);
        expect(out).not.toContain('Returns every user.');
    });

    it('flags a deprecated operation', () => {
        const route = opRoute('/users', [opOperation('get', { modifiers: ['deprecated'] })]);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).toContain('deprecated: true');
    });

    it('flags an operation deprecated by its route', () => {
        const route = opRoute('/users', [opOperation('get', {})], undefined, ['deprecated']);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).toContain('deprecated: true');
    });

    it('omits the deprecated key when the operation is current', () => {
        const route = opRoute('/users', [opOperation('get', {})]);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).not.toContain('deprecated');
    });

    it('quotes a title containing a colon so the YAML stays parseable', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'users: list' })]);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).toContain('title: "Users: List"');
    });

    it('escapes a quote inside a title', () => {
        const route = opRoute('/users', [opOperation('get', { name: 'the "good" users' })]);
        expect(renderEndpointPage(entryFor(route), '/openapi.yaml')).toContain('title: "The \\"Good\\" Users"');
    });
});

describe('renderModelPage', () => {
    const entry = (m: ReturnType<typeof model>): ModelEntry => ({ model: m, title: m.name, slug: 'user' });

    it('references the schema by name', () => {
        const out = renderModelPage(entry(model('User', [field('id', scalarType('string'))])), '/openapi.yaml');
        expect(out).toBe(['---', 'title: "User"', 'openapi-schema: "/openapi.yaml User"', '---', ''].join('\n'));
    });

    it('has no body, for the same reason an endpoint page has none', () => {
        const out = renderModelPage(entry(model('User', [], { description: 'A person.' })), '/openapi.yaml');
        expect(out.endsWith('---\n')).toBe(true);
        expect(out).not.toContain('A person.');
    });

    it('flags a deprecated model', () => {
        const out = renderModelPage(entry(model('User', [], { deprecated: true })), '/openapi.yaml');
        expect(out).toContain('deprecated: true');
    });
});

describe('renderIndexPage', () => {
    it('names the site in the title and description', () => {
        const out = renderIndexPage('Acme API');
        expect(out).toContain('title: "Acme API"');
        expect(out).toContain('description: "API reference for Acme API."');
    });

    it('says the page is user-owned', () => {
        expect(renderIndexPage('Acme API')).toContain('never overwritten');
    });
});
