import { describe, it, expect } from 'vitest';
import { schemaToTypeNode, schemasToModels, sanitizeName } from '../src/schema-to-ast.js';
import type { SchemaContext } from '../src/schema-to-ast.js';
import { WarningCollector } from '../src/warnings.js';
import type { NormalizedSchema } from '../src/types.js';

function makeCtx(overrides?: Partial<SchemaContext>): SchemaContext {
    return {
        circularRefs: new Set(),
        warnings: new WarningCollector(),
        path: '#/test',
        includeComments: true,
        namedSchemas: {},
        extractedModels: [],
        inlineCounter: 0,
        ...overrides,
    };
}

describe('schemaToTypeNode', () => {
    describe('scalar types', () => {
        it('converts string → string', () => {
            const result = schemaToTypeNode({ type: 'string' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'string' });
        });

        it('converts string with format email → email', () => {
            const result = schemaToTypeNode({ type: 'string', format: 'email' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'email' });
        });

        it('converts string with format uri → url', () => {
            const result = schemaToTypeNode({ type: 'string', format: 'uri' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'url' });
        });

        it('converts string with format uuid → uuid', () => {
            const result = schemaToTypeNode({ type: 'string', format: 'uuid' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'uuid' });
        });

        it('converts string with format date → date', () => {
            const result = schemaToTypeNode({ type: 'string', format: 'date' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'date' });
        });

        it('converts string with format date-time → datetime', () => {
            const result = schemaToTypeNode({ type: 'string', format: 'date-time' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'datetime' });
        });

        it('converts string with format binary → binary', () => {
            const result = schemaToTypeNode({ type: 'string', format: 'binary' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'binary' });
        });

        it('converts string with minLength/maxLength', () => {
            const result = schemaToTypeNode({ type: 'string', minLength: 1, maxLength: 100 }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'string', min: 1, max: 100 });
        });

        it('converts string with equal min/max to len', () => {
            const result = schemaToTypeNode({ type: 'string', minLength: 3, maxLength: 3 }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'string', len: 3 });
        });

        it('converts string with pattern', () => {
            const result = schemaToTypeNode({ type: 'string', pattern: '^[a-z]+$' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'string', regex: '/^[a-z]+$/' });
        });

        it('converts integer → int', () => {
            const result = schemaToTypeNode({ type: 'integer' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'int' });
        });

        it('converts integer with format int64 → bigint', () => {
            const result = schemaToTypeNode({ type: 'integer', format: 'int64' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'bigint' });
        });

        it('converts integer with min/max', () => {
            const result = schemaToTypeNode({ type: 'integer', minimum: 0, maximum: 100 }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'int', min: 0, max: 100 });
        });

        it('converts number → number', () => {
            const result = schemaToTypeNode({ type: 'number' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'number' });
        });

        it('converts boolean → boolean', () => {
            const result = schemaToTypeNode({ type: 'boolean' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'boolean' });
        });
    });

    describe('compound types', () => {
        it('converts array with items', () => {
            const result = schemaToTypeNode(
                {
                    type: 'array',
                    items: { type: 'string' },
                },
                makeCtx(),
            );
            expect(result).toEqual({
                kind: 'array',
                item: { kind: 'scalar', name: 'string' },
            });
        });

        it('converts array with min/maxItems', () => {
            const result = schemaToTypeNode(
                {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 10,
                },
                makeCtx(),
            );
            expect(result).toEqual({
                kind: 'array',
                item: { kind: 'scalar', name: 'string' },
                min: 1,
                max: 10,
            });
        });

        it('converts prefixItems to tuple', () => {
            const result = schemaToTypeNode(
                {
                    type: 'array',
                    prefixItems: [{ type: 'string' }, { type: 'integer' }],
                },
                makeCtx(),
            );
            expect(result).toEqual({
                kind: 'tuple',
                items: [
                    { kind: 'scalar', name: 'string' },
                    { kind: 'scalar', name: 'int' },
                ],
            });
        });

        it('converts object with additionalProperties to record', () => {
            const result = schemaToTypeNode(
                {
                    type: 'object',
                    additionalProperties: { type: 'integer' },
                },
                makeCtx(),
            );
            expect(result).toEqual({
                kind: 'record',
                key: { kind: 'scalar', name: 'string' },
                value: { kind: 'scalar', name: 'int' },
            });
        });

        it('converts enum', () => {
            const result = schemaToTypeNode({ enum: ['asc', 'desc'] }, makeCtx());
            expect(result).toEqual({ kind: 'enum', values: ['asc', 'desc'] });
        });

        it('converts const', () => {
            const result = schemaToTypeNode({ const: 'hello' }, makeCtx());
            expect(result).toEqual({ kind: 'literal', value: 'hello' });
        });
    });

    describe('combiners', () => {
        it('converts oneOf to union', () => {
            const result = schemaToTypeNode(
                {
                    oneOf: [{ type: 'string' }, { type: 'integer' }],
                },
                makeCtx(),
            );
            expect(result).toEqual({
                kind: 'union',
                members: [
                    { kind: 'scalar', name: 'string' },
                    { kind: 'scalar', name: 'int' },
                ],
            });
        });

        it('converts anyOf to union', () => {
            const result = schemaToTypeNode(
                {
                    anyOf: [{ type: 'string' }, { type: 'number' }],
                },
                makeCtx(),
            );
            expect(result).toEqual({
                kind: 'union',
                members: [
                    { kind: 'scalar', name: 'string' },
                    { kind: 'scalar', name: 'number' },
                ],
            });
        });

        it('converts allOf to intersection', () => {
            const result = schemaToTypeNode(
                {
                    allOf: [
                        { type: 'object', properties: { a: { type: 'string' } } },
                        { type: 'object', properties: { b: { type: 'integer' } } },
                    ],
                },
                makeCtx(),
            );
            expect(result.kind).toBe('intersection');
        });
    });

    describe('references', () => {
        it('converts $ref to model ref', () => {
            const result = schemaToTypeNode({ $ref: '#/components/schemas/User' }, makeCtx());
            expect(result).toEqual({ kind: 'ref', name: 'User' });
        });

        it('wraps circular $ref in lazy', () => {
            const ctx = makeCtx({ circularRefs: new Set(['TreeNode']) });
            const result = schemaToTypeNode({ $ref: '#/components/schemas/TreeNode' }, ctx);
            expect(result).toEqual({ kind: 'lazy', inner: { kind: 'ref', name: 'TreeNode' } });
        });
    });

    describe('nullable', () => {
        it('converts type array with null to union', () => {
            const result = schemaToTypeNode({ type: ['string', 'null'] } as NormalizedSchema, makeCtx());
            expect(result).toEqual({
                kind: 'union',
                members: [
                    { kind: 'scalar', name: 'string' },
                    { kind: 'scalar', name: 'null' },
                ],
            });
        });
    });

    describe('edge cases', () => {
        it('handles schema with no type', () => {
            const result = schemaToTypeNode({}, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'unknown' });
        });

        it('handles empty object type', () => {
            const result = schemaToTypeNode({ type: 'object' }, makeCtx());
            expect(result).toEqual({ kind: 'scalar', name: 'object' });
        });
    });
});

describe('schemasToModels', () => {
    it('converts object schemas to models with fields', () => {
        const schemas = {
            User: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid', readOnly: true },
                    name: { type: 'string', minLength: 1, maxLength: 100 },
                    email: { type: 'string', format: 'email' },
                    bio: { type: 'string', description: 'User bio' },
                },
                required: ['id', 'name', 'email'],
            },
        };
        const ctx = makeCtx({ namedSchemas: schemas as Record<string, NormalizedSchema> });
        const models = schemasToModels(schemas as Record<string, NormalizedSchema>, ctx);

        expect(models.length).toBe(1);
        const user = models[0]!;
        expect(user.name).toBe('User');
        expect(user.fields.length).toBe(4);

        const idField = user.fields.find(f => f.name === 'id')!;
        expect(idField.visibility).toBe('readonly');
        expect(idField.optional).toBe(false);

        const bioField = user.fields.find(f => f.name === 'bio')!;
        expect(bioField.optional).toBe(true);
        expect(bioField.description).toBe('User bio');
    });

    it('converts type aliases', () => {
        const schemas = {
            UserId: { type: 'string', format: 'uuid' },
        };
        const ctx = makeCtx({ namedSchemas: schemas as Record<string, NormalizedSchema> });
        const models = schemasToModels(schemas as Record<string, NormalizedSchema>, ctx);

        expect(models.length).toBe(1);
        expect(models[0]!.name).toBe('UserId');
        expect(models[0]!.type).toEqual({ kind: 'scalar', name: 'uuid' });
        expect(models[0]!.fields.length).toBe(0);
    });

    it('converts allOf with $ref to inheritance', () => {
        const schemas = {
            User: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
            },
            Admin: {
                allOf: [{ $ref: '#/components/schemas/User' }, { type: 'object', properties: { role: { type: 'string' } } }],
            },
        };
        const ctx = makeCtx({ namedSchemas: schemas as Record<string, NormalizedSchema> });
        const models = schemasToModels(schemas as Record<string, NormalizedSchema>, ctx);

        const admin = models.find(m => m.name === 'Admin')!;
        expect(admin.base).toBe('User');
        expect(admin.fields.length).toBe(1);
        expect(admin.fields[0]!.name).toBe('role');
    });
});

describe('sanitizeName', () => {
    it('passes through valid names', () => {
        expect(sanitizeName('User', new WarningCollector())).toBe('User');
    });

    it('sanitizes names with dots', () => {
        expect(sanitizeName('user.response', new WarningCollector())).toBe('UserResponse');
    });

    it('sanitizes names with hyphens', () => {
        expect(sanitizeName('my-model', new WarningCollector())).toBe('MyModel');
    });

    it('sanitizes names with spaces', () => {
        expect(sanitizeName('some model', new WarningCollector())).toBe('SomeModel');
    });
});
