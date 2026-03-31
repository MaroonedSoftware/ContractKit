import type { NormalizedDocument } from './types.js';
import type { WarningCollector } from './warnings.js';

/**
 * Detects the OpenAPI version from a parsed document and normalizes it to a
 * 3.1-like shape. Swagger 2.0 and OpenAPI 3.0 documents are transformed
 * so that downstream code only needs to handle one schema dialect.
 *
 * Uses @scalar/openapi-parser's `upgrade()` for the heavy lifting when
 * available, with manual fallbacks for edge cases.
 */
export function normalize(doc: Record<string, unknown>, warnings: WarningCollector): NormalizedDocument {
  const version = detectVersion(doc);

  if (version === '2.0') {
    return normalizeSwagger2(doc, warnings);
  }
  if (version === '3.0') {
    return normalizeOas30(doc as unknown as NormalizedDocument, warnings);
  }
  // 3.1+ — already in target shape
  return doc as unknown as NormalizedDocument;
}

function detectVersion(doc: Record<string, unknown>): '2.0' | '3.0' | '3.1' {
  if (typeof doc.swagger === 'string' && doc.swagger.startsWith('2')) return '2.0';
  if (typeof doc.openapi === 'string') {
    if (doc.openapi.startsWith('3.0')) return '3.0';
  }
  return '3.1';
}

// ─── Swagger 2.0 → 3.1 ───────────────────────────────────────────────────

function normalizeSwagger2(doc: Record<string, unknown>, warnings: WarningCollector): NormalizedDocument {
  const info = (doc.info as Record<string, unknown>) ?? { title: 'Untitled', version: '0.0.0' };
  const basePath = (doc.basePath as string) ?? '';
  const schemes = (doc.schemes as string[]) ?? ['https'];
  const host = (doc.host as string) ?? 'localhost';
  const globalConsumes = (doc.consumes as string[]) ?? ['application/json'];
  const globalProduces = (doc.produces as string[]) ?? ['application/json'];

  const result: NormalizedDocument = {
    openapi: '3.1.0',
    info: {
      title: (info.title as string) ?? 'Untitled',
      version: (info.version as string) ?? '0.0.0',
      description: info.description as string | undefined,
    },
    servers: [{ url: `${schemes[0]}://${host}${basePath}` }],
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {},
    },
    tags: (doc.tags as NormalizedDocument['tags']) ?? [],
  };

  // Convert definitions → components/schemas
  const definitions = (doc.definitions as Record<string, unknown>) ?? {};
  for (const [name, schema] of Object.entries(definitions)) {
    result.components!.schemas![name] = normalizeNullable30(schema as Record<string, unknown>);
  }

  // Convert securityDefinitions → components/securitySchemes
  const secDefs = (doc.securityDefinitions as Record<string, unknown>) ?? {};
  for (const [name, scheme] of Object.entries(secDefs)) {
    result.components!.securitySchemes![name] = convertSecurityScheme2(scheme as Record<string, unknown>);
  }

  // Convert paths
  const paths = (doc.paths as Record<string, Record<string, unknown>>) ?? {};
  for (const [path, pathItem] of Object.entries(paths)) {
    result.paths![path] = normalizePathItem2(pathItem, globalConsumes, globalProduces, warnings);
  }

  // Global security
  if (doc.security) {
    result.security = doc.security as Record<string, string[]>[];
  }

  return result;
}

function normalizePathItem2(
  pathItem: Record<string, unknown>,
  globalConsumes: string[],
  globalProduces: string[],
  warnings: WarningCollector,
): Record<string, unknown> {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const normalized: Record<string, unknown> = {};

  // Path-level parameters
  const pathParams = (pathItem.parameters as unknown[]) ?? [];

  for (const method of methods) {
    const op = pathItem[method] as Record<string, unknown> | undefined;
    if (!op) continue;

    const opConsumes = (op.consumes as string[]) ?? globalConsumes;
    const opProduces = (op.produces as string[]) ?? globalProduces;
    const params = [...pathParams, ...((op.parameters as unknown[]) ?? [])];

    // Separate body params from others
    const nonBodyParams: unknown[] = [];
    let requestBody: Record<string, unknown> | undefined;

    for (const param of params as Record<string, unknown>[]) {
      if (param.in === 'body') {
        const contentType = opConsumes[0] ?? 'application/json';
        requestBody = {
          description: param.description,
          required: param.required ?? true,
          content: {
            [contentType]: {
              schema: normalizeNullable30(param.schema as Record<string, unknown> ?? {}),
            },
          },
        };
      } else if (param.in === 'formData') {
        warnings.info(`#/paths/${encodePathSegment(method)}`, 'formData parameters converted to multipart/form-data requestBody');
        // Collect formData params into a schema
        if (!requestBody) {
          requestBody = {
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: {}, required: [] as string[] },
              },
            },
          };
        }
        const formSchema = (requestBody.content as Record<string, Record<string, unknown>>)['multipart/form-data']!
          .schema as Record<string, unknown>;
        const props = formSchema.properties as Record<string, unknown>;
        props[param.name as string] = normalizeNullable30(param as Record<string, unknown>);
        if (param.required) {
          (formSchema.required as string[]).push(param.name as string);
        }
      } else {
        // Convert param schema
        const normalizedParam = { ...param };
        if (param.type) {
          normalizedParam.schema = normalizeNullable30({
            type: param.type,
            format: param.format,
            enum: param.enum,
            items: param.items,
            default: param.default,
            minimum: param.minimum,
            maximum: param.maximum,
            minLength: param.minLength,
            maxLength: param.maxLength,
            pattern: param.pattern,
          } as Record<string, unknown>);
          delete normalizedParam.type;
          delete normalizedParam.format;
          delete normalizedParam.enum;
          delete normalizedParam.items;
        }
        nonBodyParams.push(normalizedParam);
      }
    }

    // Convert responses
    const responses: Record<string, unknown> = {};
    const opResponses = (op.responses as Record<string, Record<string, unknown>>) ?? {};
    for (const [code, resp] of Object.entries(opResponses)) {
      const contentType = opProduces[0] ?? 'application/json';
      if (resp.schema) {
        responses[code] = {
          description: resp.description ?? '',
          content: {
            [contentType]: {
              schema: normalizeNullable30(resp.schema as Record<string, unknown>),
            },
          },
        };
      } else {
        responses[code] = { description: resp.description ?? '' };
      }
    }

    normalized[method] = {
      operationId: op.operationId,
      summary: op.summary,
      description: op.description,
      tags: op.tags,
      parameters: nonBodyParams.length > 0 ? nonBodyParams : undefined,
      requestBody,
      responses,
      security: op.security,
      deprecated: op.deprecated,
    };
  }

  return normalized;
}

function convertSecurityScheme2(scheme: Record<string, unknown>): unknown {
  const type = scheme.type as string;
  if (type === 'basic') {
    return { type: 'http', scheme: 'basic' };
  }
  if (type === 'apiKey') {
    return { type: 'apiKey', name: scheme.name, in: scheme.in };
  }
  if (type === 'oauth2') {
    const flow = scheme.flow as string;
    const flows: Record<string, unknown> = {};
    if (flow === 'implicit') {
      flows.implicit = { authorizationUrl: scheme.authorizationUrl, scopes: scheme.scopes ?? {} };
    } else if (flow === 'password') {
      flows.password = { tokenUrl: scheme.tokenUrl, scopes: scheme.scopes ?? {} };
    } else if (flow === 'application') {
      flows.clientCredentials = { tokenUrl: scheme.tokenUrl, scopes: scheme.scopes ?? {} };
    } else if (flow === 'accessCode') {
      flows.authorizationCode = {
        authorizationUrl: scheme.authorizationUrl,
        tokenUrl: scheme.tokenUrl,
        scopes: scheme.scopes ?? {},
      };
    }
    return { type: 'oauth2', flows };
  }
  return scheme;
}

// ─── OpenAPI 3.0 → 3.1 ───────────────────────────────────────────────────

function normalizeOas30(doc: NormalizedDocument, _warnings: WarningCollector): NormalizedDocument {
  // Walk all schemas and convert `nullable: true` to type arrays
  if (doc.components?.schemas) {
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      doc.components.schemas[name] = normalizeNullable30(schema as Record<string, unknown>);
    }
  }

  // Walk paths and normalize inline schemas
  if (doc.paths) {
    for (const pathItem of Object.values(doc.paths)) {
      normalizePathItemSchemas(pathItem as Record<string, unknown>);
    }
  }

  doc.openapi = '3.1.0';
  return doc;
}

function normalizePathItemSchemas(pathItem: Record<string, unknown>): void {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  for (const method of methods) {
    const op = pathItem[method] as Record<string, unknown> | undefined;
    if (!op) continue;

    // Normalize parameter schemas
    const params = (op.parameters as Record<string, unknown>[]) ?? [];
    for (const param of params) {
      if (param.schema) {
        param.schema = normalizeNullable30(param.schema as Record<string, unknown>);
      }
    }

    // Normalize requestBody schemas
    const reqBody = op.requestBody as Record<string, unknown> | undefined;
    if (reqBody?.content) {
      for (const mediaType of Object.values(reqBody.content as Record<string, Record<string, unknown>>)) {
        if (mediaType.schema) {
          mediaType.schema = normalizeNullable30(mediaType.schema as Record<string, unknown>);
        }
      }
    }

    // Normalize response schemas
    const responses = (op.responses as Record<string, Record<string, unknown>>) ?? {};
    for (const resp of Object.values(responses)) {
      if (resp.content) {
        for (const mediaType of Object.values(resp.content as Record<string, Record<string, unknown>>)) {
          if (mediaType.schema) {
            mediaType.schema = normalizeNullable30(mediaType.schema as Record<string, unknown>);
          }
        }
      }
    }
  }
}

/**
 * Recursively converts OAS 3.0 `nullable: true` to OAS 3.1 `type: [T, "null"]`.
 * Also normalizes nested schemas (properties, items, allOf, etc.).
 */
function normalizeNullable30(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  // Convert nullable: true → type array with null
  if (result.nullable === true && typeof result.type === 'string') {
    result.type = [result.type, 'null'];
    delete result.nullable;
  }

  // Convert $ref alongside other properties (OAS 3.0 $ref with siblings was invalid,
  // but OAS 3.1 allows it — no conversion needed, just keep walking)

  // Recurse into nested schemas
  if (result.properties && typeof result.properties === 'object') {
    const props = result.properties as Record<string, Record<string, unknown>>;
    for (const [key, val] of Object.entries(props)) {
      props[key] = normalizeNullable30(val);
    }
  }
  if (result.items && typeof result.items === 'object' && !Array.isArray(result.items)) {
    result.items = normalizeNullable30(result.items as Record<string, unknown>);
  }
  if (result.additionalProperties && typeof result.additionalProperties === 'object') {
    result.additionalProperties = normalizeNullable30(result.additionalProperties as Record<string, unknown>);
  }
  for (const combiner of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (Array.isArray(result[combiner])) {
      result[combiner] = (result[combiner] as Record<string, unknown>[]).map(normalizeNullable30);
    }
  }

  return result;
}

function encodePathSegment(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}
