import type {
  DtoTypeNode,
  ScalarTypeNode,
  ModelNode,
  FieldNode,
  SourceLocation,
} from '@maroonedsoftware/contractkit';
import type { NormalizedSchema } from './types.js';
import { extractRefName } from './circular-refs.js';
import type { WarningCollector } from './warnings.js';

// ─── Conversion Context ───────────────────────────────────────────────────

export interface SchemaContext {
  /** Schema names involved in circular references — use lazy() for these. */
  circularRefs: Set<string>;
  /** Warning collector for unsupported features. */
  warnings: WarningCollector;
  /** Current JSON pointer path (for warnings). */
  path: string;
  /** Whether to include descriptions. */
  includeComments: boolean;
  /** All named schemas (for inline extraction). */
  namedSchemas: Record<string, NormalizedSchema>;
  /** Extracted inline models (accumulated during conversion). */
  extractedModels: ModelNode[];
  /** Counter for generating unique names for inline models. */
  inlineCounter: number;
}

const LOC: SourceLocation = { file: '', line: 0 };

// ─── Format → Scalar Name Mapping ────────────────────────────────────────

const FORMAT_TO_SCALAR: Record<string, ScalarTypeNode['name']> = {
  email: 'email',
  uri: 'url',
  url: 'url',
  uuid: 'uuid',
  date: 'date',
  'date-time': 'datetime',
  time: 'time',
  binary: 'binary',
  int64: 'bigint',
};

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Convert all named schemas in components/schemas to ModelNodes.
 */
export function schemasToModels(
  schemas: Record<string, NormalizedSchema>,
  ctx: SchemaContext,
): ModelNode[] {
  const models: ModelNode[] = [];

  for (const [name, schema] of Object.entries(schemas)) {
    const modelCtx = { ...ctx, path: `#/components/schemas/${name}` };
    const model = schemaToModel(name, schema, modelCtx);
    if (model) models.push(model);
  }

  // Append any inline models extracted during conversion
  models.push(...ctx.extractedModels);

  return models;
}

/**
 * Convert a named schema to a ModelNode.
 */
function schemaToModel(
  name: string,
  schema: NormalizedSchema,
  ctx: SchemaContext,
): ModelNode | null {
  warnUnsupported(schema, ctx);

  const description = ctx.includeComments ? schema.description : undefined;

  // allOf with exactly 2 members, one being a $ref → inheritance
  if (schema.allOf && schema.allOf.length === 2) {
    const [first, second] = schema.allOf;
    const refMember = first?.$ref ? first : second?.$ref ? second : null;
    const objectMember = first?.$ref ? second : first;

    if (refMember?.$ref && objectMember?.properties) {
      const baseName = extractRefName(refMember.$ref);
      if (baseName) {
        const fields = schemaPropertiesToFields(objectMember, ctx);
        return {
          kind: 'model',
          name,
          base: baseName,
          fields,
          description,
          loc: LOC,
        };
      }
    }
  }

  // Object with properties → struct
  if (schema.properties || (schema.type === 'object' && !schema.additionalProperties)) {
    const fields = schemaPropertiesToFields(schema, ctx);
    return {
      kind: 'model',
      name,
      fields,
      description,
      loc: LOC,
    };
  }

  // Otherwise → type alias
  const typeNode = schemaToTypeNode(schema, ctx);
  return {
    kind: 'model',
    name,
    fields: [],
    type: typeNode,
    description,
    loc: LOC,
  };
}

/**
 * Convert an OpenAPI schema to a DtoTypeNode.
 */
export function schemaToTypeNode(
  schema: NormalizedSchema,
  ctx: SchemaContext,
): DtoTypeNode {
  // $ref
  if (schema.$ref) {
    const refName = extractRefName(schema.$ref);
    if (refName) {
      if (ctx.circularRefs.has(refName)) {
        return { kind: 'lazy', inner: { kind: 'ref', name: refName } };
      }
      return { kind: 'ref', name: refName };
    }
    ctx.warnings.warn(ctx.path, `Unresolvable $ref: ${schema.$ref}`);
    return { kind: 'scalar', name: 'unknown' };
  }

  // const
  if (schema.const !== undefined) {
    return { kind: 'literal', value: schema.const as string | number | boolean };
  }

  // enum
  if (schema.enum) {
    return { kind: 'enum', values: schema.enum.map(String) };
  }

  // oneOf / anyOf → union
  if (schema.oneOf && schema.oneOf.length > 0) {
    return toUnion(schema.oneOf, ctx);
  }
  if (schema.anyOf && schema.anyOf.length > 0) {
    return toUnion(schema.anyOf, ctx);
  }

  // allOf → intersection
  if (schema.allOf && schema.allOf.length > 0) {
    if (schema.allOf.length === 1) {
      return schemaToTypeNode(schema.allOf[0]!, ctx);
    }
    return {
      kind: 'intersection',
      members: schema.allOf.map(s => schemaToTypeNode(s, ctx)),
    };
  }

  // Handle nullable type arrays: [string, null] → nullable
  const types = normalizeTypeField(schema);

  if (types === null) {
    // No type information at all
    if (schema.properties) {
      return schemaToInlineObject(schema, ctx);
    }
    return { kind: 'scalar', name: 'unknown' };
  }

  const { baseType, nullable } = types;

  let typeNode: DtoTypeNode;

  switch (baseType) {
    case 'string':
      typeNode = stringSchemaToType(schema);
      break;
    case 'integer':
      typeNode = integerSchemaToType(schema);
      break;
    case 'number':
      typeNode = numberSchemaToType(schema);
      break;
    case 'boolean':
      typeNode = { kind: 'scalar', name: 'boolean' };
      break;
    case 'null':
      typeNode = { kind: 'scalar', name: 'null' };
      break;
    case 'array':
      typeNode = arraySchemaToType(schema, ctx);
      break;
    case 'object':
      typeNode = objectSchemaToType(schema, ctx);
      break;
    default:
      ctx.warnings.warn(ctx.path, `Unknown type: ${baseType}`);
      typeNode = { kind: 'scalar', name: 'unknown' };
  }

  if (nullable) {
    return { kind: 'union', members: [typeNode, { kind: 'scalar', name: 'null' }] };
  }

  return typeNode;
}

// ─── Type-Specific Converters ─────────────────────────────────────────────

function stringSchemaToType(schema: NormalizedSchema): DtoTypeNode {
  // Check format first
  if (schema.format) {
    const scalarName = FORMAT_TO_SCALAR[schema.format];
    if (scalarName) {
      return { kind: 'scalar', name: scalarName };
    }
  }

  const mods: Partial<ScalarTypeNode> = {};
  if (schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength === schema.maxLength) {
    mods.len = schema.minLength;
  } else {
    if (schema.minLength !== undefined) mods.min = schema.minLength;
    if (schema.maxLength !== undefined) mods.max = schema.maxLength;
  }
  if (schema.pattern) mods.regex = `/${schema.pattern}/`;
  if (schema.format && !FORMAT_TO_SCALAR[schema.format]) mods.format = schema.format;

  return { kind: 'scalar', name: 'string', ...mods };
}

function integerSchemaToType(schema: NormalizedSchema): DtoTypeNode {
  const name: ScalarTypeNode['name'] = schema.format === 'int64' ? 'bigint' : 'int';
  const mods: Partial<ScalarTypeNode> = {};
  if (schema.minimum !== undefined) mods.min = schema.minimum;
  if (schema.maximum !== undefined) mods.max = schema.maximum;
  return { kind: 'scalar', name, ...mods };
}

function numberSchemaToType(schema: NormalizedSchema): DtoTypeNode {
  const mods: Partial<ScalarTypeNode> = {};
  if (schema.minimum !== undefined) mods.min = schema.minimum;
  if (schema.maximum !== undefined) mods.max = schema.maximum;
  return { kind: 'scalar', name: 'number', ...mods };
}

function arraySchemaToType(schema: NormalizedSchema, ctx: SchemaContext): DtoTypeNode {
  // Tuple: prefixItems (OAS 3.1)
  if (schema.prefixItems && schema.prefixItems.length > 0) {
    return {
      kind: 'tuple',
      items: schema.prefixItems.map(s => schemaToTypeNode(s, ctx)),
    };
  }

  const item = schema.items ? schemaToTypeNode(schema.items, ctx) : { kind: 'scalar' as const, name: 'unknown' as const };
  const mods: { min?: number; max?: number } = {};
  if (schema.minItems !== undefined) mods.min = schema.minItems;
  if (schema.maxItems !== undefined) mods.max = schema.maxItems;

  return { kind: 'array', item, ...mods };
}

function objectSchemaToType(schema: NormalizedSchema, ctx: SchemaContext): DtoTypeNode {
  // Record type: additionalProperties with no named properties
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !schema.properties) {
    return {
      kind: 'record',
      key: { kind: 'scalar', name: 'string' },
      value: schemaToTypeNode(schema.additionalProperties, ctx),
    };
  }

  // Object with properties → inline object or extracted model
  if (schema.properties) {
    return schemaToInlineObject(schema, ctx);
  }

  // Empty object
  return { kind: 'scalar', name: 'object' };
}

function schemaToInlineObject(schema: NormalizedSchema, ctx: SchemaContext): DtoTypeNode {
  const fields = schemaPropertiesToFields(schema, ctx);
  return { kind: 'inlineObject', fields };
}

// ─── Field Conversion ─────────────────────────────────────────────────────

function schemaPropertiesToFields(schema: NormalizedSchema, ctx: SchemaContext): FieldNode[] {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const fields: FieldNode[] = [];

  for (const [name, propSchema] of Object.entries(properties)) {
    const propCtx = { ...ctx, path: `${ctx.path}/properties/${name}` };
    const fieldType = schemaToTypeNode(propSchema, propCtx);

    // Determine nullable from the type (if it's a union with null)
    let nullable = false;
    let effectiveType = fieldType;
    if (fieldType.kind === 'union') {
      const nonNull = fieldType.members.filter(m => !(m.kind === 'scalar' && m.name === 'null'));
      if (nonNull.length < fieldType.members.length) {
        nullable = true;
        effectiveType = nonNull.length === 1 ? nonNull[0]! : { kind: 'union', members: nonNull };
      }
    }

    const visibility = propSchema.readOnly ? 'readonly' as const
      : propSchema.writeOnly ? 'writeonly' as const
      : 'normal' as const;

    fields.push({
      name,
      optional: !required.has(name),
      nullable,
      visibility,
      type: effectiveType,
      default: propSchema.default as string | number | boolean | undefined,
      deprecated: propSchema.deprecated,
      description: ctx.includeComments ? propSchema.description : undefined,
      loc: LOC,
    });
  }

  return fields;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function normalizeTypeField(schema: NormalizedSchema): { baseType: string; nullable: boolean } | null {
  if (!schema.type) return null;

  if (typeof schema.type === 'string') {
    return { baseType: schema.type, nullable: false };
  }

  if (Array.isArray(schema.type)) {
    const types = schema.type as string[];
    const nonNull = types.filter(t => t !== 'null');
    const nullable = types.includes('null');
    if (nonNull.length === 1) {
      return { baseType: nonNull[0]!, nullable };
    }
    // Multiple non-null types — unusual but handle gracefully
    if (nonNull.length === 0) {
      return { baseType: 'null', nullable: false };
    }
    // Multiple types → treat as unknown
    return { baseType: nonNull[0]!, nullable };
  }

  return null;
}

function toUnion(schemas: NormalizedSchema[], ctx: SchemaContext): DtoTypeNode {
  const members = schemas.map(s => schemaToTypeNode(s, ctx));
  if (members.length === 1) return members[0]!;
  return { kind: 'union', members };
}

function warnUnsupported(schema: NormalizedSchema, ctx: SchemaContext): void {
  if (schema.discriminator) ctx.warnings.warn(ctx.path, 'discriminator is not supported, skipping');
  if (schema.xml) ctx.warnings.warn(ctx.path, 'xml metadata is not supported, skipping');
  if (schema.externalDocs) ctx.warnings.info(ctx.path, 'externalDocs is not supported, skipping');
  if (schema.not) ctx.warnings.warn(ctx.path, 'not keyword is not supported, skipping');
}

/**
 * Extract a named model from an inline object schema (used for request/response bodies).
 */
export function extractInlineModel(
  schema: NormalizedSchema,
  suggestedName: string,
  ctx: SchemaContext,
): { typeNode: DtoTypeNode; model?: ModelNode } {
  // If it's a $ref, just use the ref
  if (schema.$ref) {
    return { typeNode: schemaToTypeNode(schema, ctx) };
  }

  // If it's an object with properties, extract as a named model
  if (schema.properties || (schema.type === 'object' && schema.additionalProperties === undefined)) {
    const fields = schemaPropertiesToFields(schema, ctx);
    const model: ModelNode = {
      kind: 'model',
      name: suggestedName,
      fields,
      description: ctx.includeComments ? schema.description : undefined,
      loc: LOC,
    };
    return {
      typeNode: { kind: 'ref', name: suggestedName },
      model,
    };
  }

  // Otherwise return the type node directly
  return { typeNode: schemaToTypeNode(schema, ctx) };
}

/**
 * Sanitize an OpenAPI schema name to a valid .ck identifier (PascalCase).
 */
export function sanitizeName(name: string, warnings: WarningCollector): string {
  // Replace dots, hyphens, spaces, and other invalid chars with word boundaries
  const cleaned = name
    .replace(/[^a-zA-Z0-9_$]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  if (cleaned !== name) {
    warnings.info(`#/components/schemas/${name}`, `Schema name sanitized: "${name}" → "${cleaned}"`);
  }

  return cleaned || 'UnnamedSchema';
}
