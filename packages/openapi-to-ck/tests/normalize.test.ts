import { describe, it, expect } from 'vitest';
import { normalize } from '../src/normalize.js';
import { WarningCollector } from '../src/warnings.js';

describe('normalize', () => {
  describe('Swagger 2.0', () => {
    it('converts definitions to components/schemas', () => {
      const doc = {
        swagger: '2.0',
        info: { title: 'Test', version: '1.0' },
        definitions: {
          User: { type: 'object', properties: { id: { type: 'string' } } },
        },
        paths: {},
      };
      const result = normalize(doc, new WarningCollector());
      expect(result.openapi).toBe('3.1.0');
      expect(result.components?.schemas?.User).toBeDefined();
      expect((result.components!.schemas!.User as Record<string, unknown>).type).toBe('object');
    });

    it('converts body parameters to requestBody', () => {
      const doc = {
        swagger: '2.0',
        info: { title: 'Test', version: '1.0' },
        definitions: {},
        paths: {
          '/users': {
            post: {
              parameters: [
                { in: 'body', name: 'body', schema: { $ref: '#/definitions/User' } },
              ],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };
      const result = normalize(doc, new WarningCollector());
      const post = (result.paths!['/users'] as Record<string, unknown>).post as Record<string, unknown>;
      expect(post.requestBody).toBeDefined();
      const reqBody = post.requestBody as Record<string, unknown>;
      expect(reqBody.content).toHaveProperty('application/json');
    });

    it('converts securityDefinitions to components/securitySchemes', () => {
      const doc = {
        swagger: '2.0',
        info: { title: 'Test', version: '1.0' },
        definitions: {},
        securityDefinitions: {
          BasicAuth: { type: 'basic' },
          ApiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        },
        paths: {},
      };
      const result = normalize(doc, new WarningCollector());
      const schemes = result.components!.securitySchemes!;
      expect((schemes.BasicAuth as Record<string, unknown>).type).toBe('http');
      expect((schemes.ApiKey as Record<string, unknown>).type).toBe('apiKey');
    });

    it('builds server from host, basePath, schemes', () => {
      const doc = {
        swagger: '2.0',
        info: { title: 'Test', version: '1.0' },
        host: 'api.example.com',
        basePath: '/v1',
        schemes: ['https'],
        paths: {},
      };
      const result = normalize(doc, new WarningCollector());
      expect(result.servers![0]!.url).toBe('https://api.example.com/v1');
    });
  });

  describe('OpenAPI 3.0', () => {
    it('converts nullable: true to type array', () => {
      const doc = {
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0' },
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                name: { type: 'string', nullable: true },
              },
            },
          },
        },
      };
      const result = normalize(doc as Record<string, unknown>, new WarningCollector());
      expect(result.openapi).toBe('3.1.0');
      const nameSchema = (result.components!.schemas!.User as Record<string, Record<string, unknown>>).properties!.name;
      expect(nameSchema.type).toEqual(['string', 'null']);
      expect(nameSchema.nullable).toBeUndefined();
    });
  });

  describe('OpenAPI 3.1', () => {
    it('passes through 3.1 documents unchanged', () => {
      const doc = {
        openapi: '3.1.0',
        info: { title: 'Test', version: '1.0' },
        components: {
          schemas: {
            User: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      };
      const result = normalize(doc as Record<string, unknown>, new WarningCollector());
      expect(result.openapi).toBe('3.1.0');
      expect(result.components?.schemas?.User).toBeDefined();
    });
  });
});
