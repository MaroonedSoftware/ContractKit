import { describe, expect, it } from 'vitest';
import { renderTryIt } from '../src/render-tryit.js';
import type { RenderContext } from '../src/types.js';
import { field, inlineObj, model, op, param, ref, resolvedModel, resolvedOp, scalar } from './helpers.js';

describe('renderTryIt', () => {
    it('pre-fills the body textarea with a faker-generated sample matching the request schema', () => {
        const ctx: RenderContext = {
            models: new Map([
                [
                    'CreateUserInput',
                    resolvedModel(model('CreateUserInput', [
                        field('email', scalar('string')),
                        field('firstName', scalar('string')),
                        field('age', scalar('int', { min: 18, max: 80 })),
                    ])),
                ],
            ]),
        };
        const html = renderTryIt(
            resolvedOp('/users', op('post', {
                request: {
                    bodies: [{ contentType: 'application/json', bodyType: ref('CreateUserInput') }],
                },
            })),
            'https://api.example.com',
            ctx,
        );
        expect(html).toContain('<textarea name="body"');
        // Body is pre-filled (not just placeholder), with realistic fields.
        expect(html).toMatch(/<textarea[^>]*>\{[^]+&quot;email&quot;:/);
        expect(html).toMatch(/&quot;firstName&quot;:/);
        expect(html).toMatch(/&quot;age&quot;:/);
    });

    it('excludes readonly fields from the body pre-fill', () => {
        const html = renderTryIt(
            resolvedOp('/users', op('post', {
                request: {
                    bodies: [{
                        contentType: 'application/json',
                        bodyType: inlineObj([
                            field('id', scalar('uuid'), { visibility: 'readonly' }),
                            field('email', scalar('string')),
                        ]),
                    }],
                },
            })),
            'https://api.example.com',
            {},
        );
        expect(html).toMatch(/<textarea[^>]*>\{[^]*&quot;email&quot;:/);
        expect(html).not.toMatch(/<textarea[^>]*>[^<]*&quot;id&quot;:/);
    });

    it('pre-fills path/query/header inputs with sample values from their type', () => {
        const html = renderTryIt(
            resolvedOp('/users/{id}', op('get', {
                query: { kind: 'params', nodes: [param('limit', scalar('int', { min: 1, max: 100 }))] },
                headers: { kind: 'params', nodes: [param('X-Trace-Id', scalar('uuid'))] },
            }), {
                routeParams: { kind: 'params', nodes: [param('id', scalar('uuid'))] },
            }),
            'https://api.example.com',
            {},
        );
        // Each input has a non-empty value attribute.
        expect(html).toMatch(/name="path\.id"[^>]*\bvalue="[0-9a-f-]{36}"/);
        expect(html).toMatch(/name="query\.limit"[^>]*\bvalue="\d+"/);
        expect(html).toMatch(/name="header\.X-Trace-Id"[^>]*\bvalue="[0-9a-f-]{36}"/);
    });

    it('respects explicit defaults over generated samples', () => {
        const html = renderTryIt(
            resolvedOp('/items', op('get', {
                query: {
                    kind: 'params',
                    nodes: [param('sort', scalar('string'), { default: 'asc' })],
                },
            })),
            'https://api.example.com',
            {},
        );
        expect(html).toMatch(/name="query\.sort"[^>]*\bvalue="asc"/);
    });

    it('renders the same pre-filled body twice for the same operation (deterministic)', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['Foo', resolvedModel(model('Foo', [field('email', scalar('string'))]))],
            ]),
        };
        const args = [
            resolvedOp('/foos', op('post', {
                request: { bodies: [{ contentType: 'application/json', bodyType: ref('Foo') }] },
            })),
            'https://api.example.com',
            ctx,
        ] as const;
        expect(renderTryIt(...args)).toBe(renderTryIt(...args));
    });
});
