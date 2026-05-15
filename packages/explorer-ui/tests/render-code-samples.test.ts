import { describe, expect, it } from 'vitest';
import { renderCodeSamples } from '../src/render-code-samples.js';
import type { RenderContext } from '../src/types.js';
import { field, inlineObj, model, op, ref, resolvedModel, resolvedOp, scalar } from './helpers.js';

describe('renderCodeSamples', () => {
    it('renders a curl request with method and url', () => {
        const html = renderCodeSamples(
            resolvedOp('/todos', op('get', { responses: [{ statusCode: 200 }] })),
            'https://api.example.com',
        );
        expect(html).toContain('Request Sample');
        expect(html).toContain('curl --request GET');
        expect(html).toContain('--url https://api.example.com/todos');
    });

    it('adds an Accept header when a JSON response is declared', () => {
        const html = renderCodeSamples(
            resolvedOp('/todos', op('get', {
                responses: [{ statusCode: 200, contentType: 'application/json', bodyType: scalar('string') }],
            })),
            'https://api.example.com',
        );
        expect(html).toContain('Accept: application/json');
    });

    it('includes --data with a sample body when the request has a JSON body', () => {
        const html = renderCodeSamples(
            resolvedOp('/todos', op('post', {
                request: {
                    bodies: [{
                        contentType: 'application/json',
                        bodyType: inlineObj([
                            field('title', scalar('string')),
                            field('id', scalar('uuid'), { visibility: 'readonly' }),
                        ]),
                    }],
                },
                responses: [{ statusCode: 201 }],
            })),
            'https://api.example.com',
        );
        expect(html).toContain('Content-Type: application/json');
        // `--data '{...}'` is present with the title field.
        expect(html).toMatch(/--data &#39;\{[^]*&quot;title&quot;:/);
        // Readonly fields are excluded from the request payload.
        expect(html).not.toMatch(/--data &#39;[^&]*&quot;id&quot;:/);
    });

    it('synthesizes a JSON response example from the primary 2xx body type', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['Todo', resolvedModel(model('Todo', [
                    field('id', scalar('int')),
                    field('name', scalar('string')),
                    field('completed', scalar('boolean')),
                ]))],
            ]),
        };
        const html = renderCodeSamples(
            resolvedOp('/todos/{id}', op('get', {
                responses: [{ statusCode: 200, contentType: 'application/json', bodyType: ref('Todo') }],
            })),
            'https://api.example.com',
            ctx,
        );
        expect(html).toContain('Response Example');
        expect(html).toContain('&quot;id&quot;:');
        expect(html).toContain('&quot;name&quot;:');
        expect(html).toContain('&quot;completed&quot;:');
        // Boolean field renders as a JSON literal (true or false), not quoted.
        expect(html).toMatch(/&quot;completed&quot;: (true|false)/);
    });

    it('picks a realistic value based on the field name (email)', () => {
        const html = renderCodeSamples(
            resolvedOp('/users', op('get', {
                responses: [{
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyType: inlineObj([field('email', scalar('string'))]),
                }],
            })),
            'https://api.example.com',
        );
        // Email-looking value (faker: user[.lastname][digits]@provider.tld).
        expect(html).toMatch(/&quot;email&quot;: &quot;[^"]+@[^"]+\.[a-z]+&quot;/i);
    });

    it('produces a uuid value for a uuid scalar', () => {
        const html = renderCodeSamples(
            resolvedOp('/todos', op('get', {
                responses: [{
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyType: inlineObj([field('id', scalar('uuid'))]),
                }],
            })),
            'https://api.example.com',
        );
        expect(html).toMatch(/&quot;id&quot;: &quot;[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}&quot;/);
    });

    it('produces an ISO datetime for a datetime scalar', () => {
        const html = renderCodeSamples(
            resolvedOp('/events', op('get', {
                responses: [{
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyType: inlineObj([field('createdAt', scalar('datetime'))]),
                }],
            })),
            'https://api.example.com',
        );
        expect(html).toMatch(/&quot;createdAt&quot;: &quot;\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('renders the same value twice for the same operation/field (deterministic)', () => {
        const ctx: RenderContext = { models: new Map() };
        const args = [
            resolvedOp('/users', op('get', {
                responses: [{
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyType: inlineObj([field('email', scalar('string'))]),
                }],
            })),
            'https://api.example.com',
            ctx,
        ] as const;
        expect(renderCodeSamples(...args)).toBe(renderCodeSamples(...args));
    });

    it('omits writeonly fields from the response example', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['User', resolvedModel(model('User', [
                    field('id', scalar('int')),
                    field('password', scalar('string'), { visibility: 'writeonly' }),
                ]))],
            ]),
        };
        const html = renderCodeSamples(
            resolvedOp('/users/{id}', op('get', {
                responses: [{ statusCode: 200, contentType: 'application/json', bodyType: ref('User') }],
            })),
            'https://api.example.com',
            ctx,
        );
        expect(html).toContain('&quot;id&quot;');
        expect(html).not.toContain('&quot;password&quot;');
    });

    it('falls back to a placeholder base url when none is configured', () => {
        const html = renderCodeSamples(
            resolvedOp('/todos', op('get')),
            '',
        );
        expect(html).toContain('--url https://api.example.com/todos');
    });

    it('omits Response Example when no 2xx JSON response is declared', () => {
        const html = renderCodeSamples(
            resolvedOp('/todos', op('get', { responses: [{ statusCode: 204 }] })),
            'https://api.example.com',
        );
        expect(html).not.toContain('Response Example');
    });

    it('handles inline object responses without a models map', () => {
        const html = renderCodeSamples(
            resolvedOp('/todos', op('get', {
                responses: [{
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyType: inlineObj([field('id', scalar('int')), field('name', scalar('string'))]),
                }],
            })),
            'https://api.example.com',
        );
        expect(html).toContain('Response Example');
        expect(html).toContain('&quot;id&quot;:');
        expect(html).toContain('&quot;name&quot;:');
    });

    it('includes inherited fields from bases in the JSON sample', async () => {
        const helpers = await import('./helpers.js');
        const ctx: RenderContext = {
            models: new Map([
                ['Base', helpers.resolvedModel(helpers.model('Base', [
                    helpers.field('active', helpers.scalar('boolean')),
                ]))],
                ['Pagination', helpers.resolvedModel(helpers.model('Pagination', [
                    helpers.field('page', helpers.scalar('int')),
                    helpers.field('pageSize', helpers.scalar('int')),
                ]))],
                ['BusinessPagination', helpers.resolvedModel(helpers.model('BusinessPagination',
                    [helpers.field('extra', helpers.scalar('string'))],
                    { bases: ['Base', 'Pagination'] },
                ))],
            ]),
        };
        const html = renderCodeSamples(
            resolvedOp('/x', op('get', {
                responses: [{
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyType: ref('BusinessPagination'),
                }],
            })),
            'https://api.example.com',
            ctx,
        );
        // All inherited keys appear in the JSON sample.
        expect(html).toContain('&quot;active&quot;:');
        expect(html).toContain('&quot;page&quot;:');
        expect(html).toContain('&quot;pageSize&quot;:');
        expect(html).toContain('&quot;extra&quot;:');
    });

    it('merges all members of an intersection in the JSON sample', () => {
        const html = renderCodeSamples(
            resolvedOp('/x', op('get', {
                responses: [{
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyType: {
                        kind: 'intersection',
                        members: [
                            inlineObj([field('a', scalar('boolean'))]),
                            inlineObj([field('b', scalar('int'))]),
                        ],
                    },
                }],
            })),
            'https://api.example.com',
        );
        expect(html).toContain('&quot;a&quot;:');
        expect(html).toContain('&quot;b&quot;:');
    });
});
