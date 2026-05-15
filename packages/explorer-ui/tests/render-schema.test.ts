import { describe, expect, it } from 'vitest';
import { renderSchemaTree } from '../src/render-schema.js';
import type { RenderContext } from '../src/types.js';
import { array, discriminated, enumT, field, inlineObj, intersection, literal, model, ref, resolvedModel, scalar, union } from './helpers.js';

describe('renderSchemaTree', () => {
    it('renders an inline object as an indented field tree with name + type + required tag', () => {
        const html = renderSchemaTree(
            inlineObj([
                field('id', scalar('int', { min: 0, max: 9999 })),
                field('name', scalar('string', { min: 1, max: 100 })),
                field('completed', scalar('boolean'), { optional: true, default: false }),
            ]),
        );
        expect(html).toContain('class="ce-schema-fields"');
        expect(html).toContain('<code class="ce-schema-name">id</code>');
        expect(html).toContain('<span class="ce-schema-type">int</span>');
        expect(html).toContain('<span class="ce-schema-required">required</span>');
    });

    it('renders constraint chips with character unit on string scalars', () => {
        const html = renderSchemaTree(
            inlineObj([
                field('id', scalar('int', { min: 0, max: 9999 })),
                field('name', scalar('string', { min: 1, max: 100 })),
            ]),
        );
        expect(html).toContain('<span class="ce-schema-chip">&gt;= 0</span>');
        expect(html).toContain('<span class="ce-schema-chip">&lt;= 9999</span>');
        expect(html).toContain('<span class="ce-schema-chip">&gt;= 1 characters</span>');
        expect(html).toContain('<span class="ce-schema-chip">&lt;= 100 characters</span>');
    });

    it('suppresses the required pill when a non-optional field has a default value', () => {
        // `page` is non-optional but has `default: 0` — server fills it in if omitted, so the
        // caller doesn't need to provide it. The pill would be misleading noise.
        const html = renderSchemaTree(
            inlineObj([field('page', scalar('int', { min: 0 }), { default: 0 })]),
        );
        expect(html).not.toMatch(/ce-schema-name">page<\/code>[^]*?required<\/span>/);
        expect(html).toContain('Default: <code>0</code>');
    });

    it('omits required tag and renders default for optional fields', () => {
        const html = renderSchemaTree(
            inlineObj([field('completed', scalar('boolean'), { optional: true, default: false })]),
        );
        expect(html).not.toMatch(/ce-schema-name">completed<\/code>[^]*?required<\/span>/);
        expect(html).toContain('Default: <code>false</code>');
    });

    it('renders an array of inline objects with an "array of:" label', () => {
        const html = renderSchemaTree(
            array(inlineObj([field('id', scalar('int'))])),
        );
        expect(html).toContain('array of:');
        expect(html).toContain('<code class="ce-schema-name">id</code>');
    });

    it('expands a ref through the models map', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['Todo', resolvedModel(model('Todo', [field('id', scalar('int')), field('name', scalar('string'))]))],
            ]),
        };
        const html = renderSchemaTree(ref('Todo'), ctx);
        expect(html).toContain('<code class="ce-schema-name">id</code>');
        expect(html).toContain('<code class="ce-schema-name">name</code>');
    });

    it('renders inline enum values under the field row', () => {
        const html = renderSchemaTree(
            inlineObj([field('status', enumT('active', 'archived', 'pending'))]),
        );
        expect(html).toContain('class="ce-schema-enum"');
        expect(html).toContain('Allowed values:');
        expect(html).toContain('<code class="ce-schema-enum-value">active</code>');
        expect(html).toContain('<code class="ce-schema-enum-value">archived</code>');
        expect(html).toContain('<code class="ce-schema-enum-value">pending</code>');
    });

    it('renders enum values for a ref to a model whose type alias is an enum', () => {
        const ctx: RenderContext = {
            models: new Map([
                [
                    'ApplicationStatus',
                    resolvedModel(model('ApplicationStatus', [], { type: enumT('active', 'archived', 'pending') })),
                ],
            ]),
        };
        const html = renderSchemaTree(
            inlineObj([field('status', ref('ApplicationStatus'))]),
            ctx,
        );
        // The field's type label still points at the model name.
        expect(html).toMatch(/ce-schema-type[^>]*>ApplicationStatus</);
        // The enum values appear beneath the field row.
        expect(html).toContain('Allowed values:');
        expect(html).toContain('<code class="ce-schema-enum-value">active</code>');
        expect(html).toContain('<code class="ce-schema-enum-value">archived</code>');
        expect(html).toContain('<code class="ce-schema-enum-value">pending</code>');
    });

    it('renders a discriminated union as an accordion of expandable variants with discriminator values', () => {
        const ctx: RenderContext = {
            models: new Map([
                [
                    'PhoneFactor',
                    resolvedModel(model('PhoneFactor', [
                        field('method', literal('phone')),
                        field('number', scalar('string')),
                    ])),
                ],
                [
                    'EmailFactor',
                    resolvedModel(model('EmailFactor', [
                        field('method', literal('email')),
                        field('address', scalar('email')),
                    ])),
                ],
            ]),
        };
        const html = renderSchemaTree(
            discriminated('method', ref('PhoneFactor'), ref('EmailFactor')),
            ctx,
        );
        expect(html).toContain('class="ce-schema-union"');
        expect(html).toContain('class="ce-schema-union-variants"');
        // Discriminator label + accordion entries per variant.
        expect(html).toMatch(/by <code>method<\/code>/);
        expect(html).toContain('<details class="ce-schema-variant">');
        expect(html).toContain('ce-schema-variant-name">PhoneFactor');
        expect(html).toContain('ce-schema-variant-name">EmailFactor');
        // Discriminator literal value is surfaced on each variant header.
        expect(html).toContain('method: &quot;phone&quot;');
        expect(html).toContain('method: &quot;email&quot;');
        // Variant bodies contain the member's fields, rendered as a schema tree.
        expect(html).toContain('<code class="ce-schema-name">number</code>');
        expect(html).toContain('<code class="ce-schema-name">address</code>');
    });

    it('flattens an intersection of a ref and an inline object into a merged field list', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['Pagination', resolvedModel(model('Pagination', [
                    field('page', scalar('int', { min: 0 })),
                    field('pageSize', scalar('int', { min: 1, max: 100 })),
                ]))],
            ]),
        };
        const html = renderSchemaTree(
            intersection(ref('Pagination'), inlineObj([field('meta', scalar('string'))])),
            ctx,
        );
        expect(html).toContain('<code class="ce-schema-name">page</code>');
        expect(html).toContain('<code class="ce-schema-name">pageSize</code>');
        expect(html).toContain('<code class="ce-schema-name">meta</code>');
        // The inline `& { ... }` separator from `renderType` should NOT leak into the output.
        expect(html).not.toContain('ce-type-token');
    });

    it('renders an intersection field type label as `A & B` and expands its merged fields', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['Pagination', resolvedModel(model('Pagination', [field('page', scalar('int'))]))],
            ]),
        };
        const html = renderSchemaTree(
            inlineObj([field('meta', intersection(ref('Pagination'), inlineObj([field('x', scalar('string'))])))]),
            ctx,
        );
        // Label reads "Pagination & { … }" rather than a bare "intersection".
        expect(html).toMatch(/ce-schema-type">Pagination &amp; \{[^<]*\}<\/span>/);
        // Nested expansion shows the merged fields.
        expect(html).toContain('class="ce-schema-nested"');
        expect(html).toContain('<code class="ce-schema-name">page</code>');
        expect(html).toContain('<code class="ce-schema-name">x</code>');
    });

    it('renders a plain (non-discriminated) union without a discriminator label', () => {
        const html = renderSchemaTree(union(scalar('string'), scalar('int')));
        expect(html).toContain('class="ce-schema-union"');
        // Plain union has no "by <field>" label.
        expect(html).toContain('One of');
        expect(html).not.toMatch(/by <code>/);
    });

    it('flattens inherited fields when a model extends bases (multi-base inheritance)', () => {
        // `contract BusinessPagination: BusinessQueryFilters & Pagination & { extra: int }`
        // — bases contribute their fields, own fields are appended.
        const ctx: RenderContext = {
            models: new Map([
                ['BusinessQueryFilters', resolvedModel(model('BusinessQueryFilters', [
                    field('active', scalar('boolean')),
                    field('organizationId', scalar('uuid')),
                ]))],
                ['Pagination', resolvedModel(model('Pagination', [
                    field('page', scalar('int', { min: 0 }), { default: 0 }),
                    field('pageSize', scalar('int'), { default: 25 }),
                    field('total', scalar('int', { min: 0 }), { visibility: 'readonly' }),
                ]))],
                ['BusinessPagination', resolvedModel(model('BusinessPagination',
                    [field('extra', scalar('int'))],
                    { bases: ['BusinessQueryFilters', 'Pagination'] },
                ))],
            ]),
        };
        const html = renderSchemaTree(ref('BusinessPagination'), ctx);
        // Inherited fields from BusinessQueryFilters and Pagination both appear.
        expect(html).toContain('<code class="ce-schema-name">active</code>');
        expect(html).toContain('<code class="ce-schema-name">organizationId</code>');
        expect(html).toContain('<code class="ce-schema-name">page</code>');
        expect(html).toContain('<code class="ce-schema-name">pageSize</code>');
        expect(html).toContain('<code class="ce-schema-name">total</code>');
        // Own field appears.
        expect(html).toContain('<code class="ce-schema-name">extra</code>');
    });

    it('flattens fields through type-alias bases (alias to inline object)', () => {
        // BusinessQueryFilters is declared as a TYPE ALIAS to an inline object (model.type set,
        // model.fields empty). Its fields must still contribute when used as a base.
        const ctx: RenderContext = {
            models: new Map([
                ['BusinessQueryFilters', resolvedModel(model('BusinessQueryFilters', [], {
                    type: inlineObj([
                        field('active', scalar('boolean')),
                        field('organizationId', scalar('uuid')),
                    ]),
                }))],
                ['BusinessPagination', resolvedModel(model('BusinessPagination',
                    [field('extra', scalar('int'))],
                    { bases: ['BusinessQueryFilters'] },
                ))],
            ]),
        };
        const html = renderSchemaTree(ref('BusinessPagination'), ctx);
        expect(html).toContain('<code class="ce-schema-name">active</code>');
        expect(html).toContain('<code class="ce-schema-name">organizationId</code>');
        expect(html).toContain('<code class="ce-schema-name">extra</code>');
    });

    it('flattens nested intersections via type-alias bases', () => {
        // Pagination is an alias to an intersection of two other models.
        const ctx: RenderContext = {
            models: new Map([
                ['BasePagination', resolvedModel(model('BasePagination', [
                    field('page', scalar('int')),
                    field('pageSize', scalar('int')),
                ]))],
                ['SortOptions', resolvedModel(model('SortOptions', [
                    field('sort', scalar('string')),
                ]))],
                ['Pagination', resolvedModel(model('Pagination', [], {
                    type: {
                        kind: 'intersection',
                        members: [ref('BasePagination'), ref('SortOptions')],
                    },
                }))],
                ['BusinessPagination', resolvedModel(model('BusinessPagination',
                    [field('extra', scalar('int'))],
                    { bases: ['Pagination'] },
                ))],
            ]),
        };
        const html = renderSchemaTree(ref('BusinessPagination'), ctx);
        // All transitively inherited fields appear.
        expect(html).toContain('<code class="ce-schema-name">page</code>');
        expect(html).toContain('<code class="ce-schema-name">pageSize</code>');
        expect(html).toContain('<code class="ce-schema-name">sort</code>');
        expect(html).toContain('<code class="ce-schema-name">extra</code>');
    });

    it('surfaces unresolved bases when a model extends a contract not in the workspace', () => {
        const ctx: RenderContext = {
            models: new Map([
                // BusinessPagination extends Pagination which isn't in the index.
                ['BusinessPagination', resolvedModel(model('BusinessPagination',
                    [field('extra', scalar('int'))],
                    { bases: ['Pagination'] },
                ))],
            ]),
        };
        const html = renderSchemaTree(ref('BusinessPagination'), ctx);
        expect(html).toContain('<code class="ce-schema-name">extra</code>');
        expect(html).toContain('class="ce-schema-unresolved"');
        expect(html).toContain('>Pagination<');
    });

    it('renders fields from resolvable intersection members and flags unresolved refs', () => {
        // BusinessQueryFilters is in the workspace; Pagination is not. The intersection should
        // still show the available fields plus a clear "Unresolved" diagnostic for Pagination.
        const ctx: RenderContext = {
            models: new Map([
                ['BusinessQueryFilters', resolvedModel(model('BusinessQueryFilters', [
                    field('active', scalar('boolean')),
                    field('organizationId', scalar('uuid')),
                ]))],
            ]),
        };
        const html = renderSchemaTree(
            intersection(ref('BusinessQueryFilters'), ref('Pagination')),
            ctx,
        );
        // Resolvable member's fields appear.
        expect(html).toContain('<code class="ce-schema-name">active</code>');
        expect(html).toContain('<code class="ce-schema-name">organizationId</code>');
        // Unresolved ref is surfaced as a diagnostic chip rather than silently dropped.
        expect(html).toContain('class="ce-schema-unresolved"');
        expect(html).toContain('>Pagination<');
    });

    it('renders an unresolved indicator when a top-level ref isn\'t in the workspace', () => {
        const html = renderSchemaTree(ref('MissingModel'), { models: new Map() });
        expect(html).toContain('class="ce-schema-unresolved"');
        expect(html).toContain('>MissingModel<');
    });

    it('excludes readonly fields when rendering a request input schema', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['Pagination', resolvedModel(model('Pagination', [
                    field('page', scalar('int', { min: 0 }), { default: 0 }),
                    field('pageSize', scalar('int'), { default: 25 }),
                    field('total', scalar('int', { min: 0 }), { visibility: 'readonly' }),
                ]))],
            ]),
        };
        const html = renderSchemaTree(ref('Pagination'), ctx, { exclude: 'readonly' });
        expect(html).toContain('<code class="ce-schema-name">page</code>');
        expect(html).toContain('<code class="ce-schema-name">pageSize</code>');
        // The readonly `total` field is suppressed when rendering as a request input.
        expect(html).not.toContain('<code class="ce-schema-name">total</code>');
    });

    it('excludes writeonly fields when rendering a response schema', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['User', resolvedModel(model('User', [
                    field('id', scalar('uuid')),
                    field('email', scalar('email')),
                    field('password', scalar('string'), { visibility: 'writeonly' }),
                ]))],
            ]),
        };
        const html = renderSchemaTree(ref('User'), ctx, { exclude: 'writeonly' });
        expect(html).toContain('<code class="ce-schema-name">id</code>');
        expect(html).toContain('<code class="ce-schema-name">email</code>');
        expect(html).not.toContain('<code class="ce-schema-name">password</code>');
    });

    it('does not render enum values for refs that point to object models', () => {
        const ctx: RenderContext = {
            models: new Map([
                ['Todo', resolvedModel(model('Todo', [field('id', scalar('int'))]))],
            ]),
        };
        const html = renderSchemaTree(
            inlineObj([field('todo', ref('Todo'))]),
            ctx,
        );
        expect(html).not.toContain('ce-schema-enum-value');
        expect(html).not.toContain('Allowed values:');
    });
});
