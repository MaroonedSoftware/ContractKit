import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOpenApiToCk } from '../src/convert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

describe('convertOpenApiToCk', () => {
  describe('OpenAPI 3.1 Petstore', () => {
    it('converts to split .ck files by tag', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

      expect(result.files.size).toBeGreaterThan(0);

      // Should have pets and store files
      const filenames = [...result.files.keys()];
      expect(filenames.some(f => f.includes('pets'))).toBe(true);
      expect(filenames.some(f => f.includes('store'))).toBe(true);
    });

    it('includes Pet model in pets file', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

      const petsFile = [...result.files.entries()].find(([k]) => k.includes('pets'));
      expect(petsFile).toBeDefined();
      const [, content] = petsFile!;

      expect(content).toContain('contract Pet:');
      expect(content).toContain('id: readonly uuid');
      expect(content).toContain('name: string(min=1, max=100)');
      expect(content).toContain('status: enum(available, pending, sold)');
      expect(content).toContain('createdAt: readonly datetime');
    });

    it('includes operations in pets file', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

      const petsFile = [...result.files.entries()].find(([k]) => k.includes('pets'));
      const [, content] = petsFile!;

      expect(content).toContain('operation /pets:');
      expect(content).toContain('get:');
      expect(content).toContain('post:');
      expect(content).toContain('operation /pets/{petId}:');
      expect(content).toContain('sdk: listPets');
      expect(content).toContain('sdk: createPet');
    });

    it('marks delete with security: none', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

      const petsFile = [...result.files.entries()].find(([k]) => k.includes('pets'));
      const [, content] = petsFile!;

      expect(content).toContain('security: none');
    });

    it('converts to single file', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'single' });

      expect(result.files.size).toBe(1);
      expect(result.files.has('api.ck')).toBe(true);

      const content = result.files.get('api.ck')!;
      expect(content).toContain('contract Pet:');
      expect(content).toContain('operation /pets:');
      expect(content).toContain('operation /store/inventory:');
    });

    it('includes descriptions as comments', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'single', includeComments: true });

      const content = result.files.get('api.ck')!;
      expect(content).toContain('# A pet in the store');
      expect(content).toContain('# The pet identifier');
    });

    it('omits comments when includeComments is false', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'single', includeComments: false });

      const content = result.files.get('api.ck')!;
      expect(content).not.toContain('#');
    });

    it('handles path params', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'single' });

      const content = result.files.get('api.ck')!;
      expect(content).toContain('params: {');
      expect(content).toContain('petId: uuid');
    });

    it('handles record types (additionalProperties)', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'single' });

      const content = result.files.get('api.ck')!;
      // Store inventory returns a record
      expect(content).toContain('record(string, int)');
    });

    it('handles empty responses (204)', async () => {
      const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
      const result = await convertOpenApiToCk({ input: spec, split: 'single' });

      const content = result.files.get('api.ck')!;
      expect(content).toContain('204:');
    });
  });

  describe('inline spec object', () => {
    it('converts a minimal spec', async () => {
      const result = await convertOpenApiToCk({
        input: {
          openapi: '3.1.0',
          info: { title: 'Minimal', version: '1.0' },
          components: {
            schemas: {
              Ping: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
            },
          },
          paths: {
            '/ping': {
              get: {
                operationId: 'ping',
                responses: {
                  '200': {
                    description: 'OK',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Ping' } } },
                  },
                },
              },
            },
          },
        },
        split: 'single',
      });

      expect(result.files.size).toBe(1);
      const content = result.files.get('api.ck')!;
      expect(content).toContain('contract Ping:');
      expect(content).toContain('ok: boolean');
      expect(content).toContain('operation /ping:');
    });
  });

  describe('warnings', () => {
    it('collects warnings for unsupported features', async () => {
      const warnings: string[] = [];
      await convertOpenApiToCk({
        input: {
          openapi: '3.1.0',
          info: { title: 'Test', version: '1.0' },
          components: {
            schemas: {
              WithDiscriminator: {
                type: 'object',
                discriminator: { propertyName: 'type' },
                properties: { type: { type: 'string' } },
              },
            },
          },
          paths: {},
        },
        split: 'single',
        onWarning: (w) => warnings.push(w.message),
      });

      expect(warnings.some(w => w.includes('discriminator'))).toBe(true);
    });
  });
});
