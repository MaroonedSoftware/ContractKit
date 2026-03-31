import { describe, it, expect } from 'vitest';
import { detectCircularRefs, extractRefName } from '../src/circular-refs.js';

describe('detectCircularRefs', () => {
  it('detects no cycles in acyclic schemas', () => {
    const schemas = {
      User: { type: 'object', properties: { address: { $ref: '#/components/schemas/Address' } } },
      Address: { type: 'object', properties: { city: { type: 'string' } } },
    };
    const result = detectCircularRefs(schemas);
    expect(result.size).toBe(0);
  });

  it('detects direct self-reference', () => {
    const schemas = {
      TreeNode: {
        type: 'object',
        properties: {
          children: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } },
        },
      },
    };
    const result = detectCircularRefs(schemas);
    expect(result.has('TreeNode')).toBe(true);
  });

  it('detects indirect cycle (A → B → A)', () => {
    const schemas = {
      A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
      B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
    };
    const result = detectCircularRefs(schemas);
    expect(result.has('A')).toBe(true);
  });

  it('detects cycles in allOf', () => {
    const schemas = {
      Parent: {
        type: 'object',
        properties: { child: { $ref: '#/components/schemas/Child' } },
      },
      Child: {
        allOf: [
          { $ref: '#/components/schemas/Parent' },
          { type: 'object', properties: { extra: { type: 'string' } } },
        ],
      },
    };
    const result = detectCircularRefs(schemas);
    expect(result.size).toBeGreaterThan(0);
  });

  it('handles schemas with no refs', () => {
    const schemas = {
      Simple: { type: 'string' },
    };
    const result = detectCircularRefs(schemas);
    expect(result.size).toBe(0);
  });
});

describe('extractRefName', () => {
  it('extracts from components/schemas ref', () => {
    expect(extractRefName('#/components/schemas/User')).toBe('User');
  });

  it('extracts from definitions ref', () => {
    expect(extractRefName('#/definitions/User')).toBe('User');
  });

  it('returns undefined for other refs', () => {
    expect(extractRefName('#/components/parameters/id')).toBeUndefined();
  });
});
