import type {
  DtoRootNode, ModelNode, FieldNode, DtoTypeNode,
  ScalarTypeNode, ArrayTypeNode, TupleTypeNode, RecordTypeNode,
  EnumTypeNode, LiteralTypeNode, UnionTypeNode, ModelRefTypeNode,
  InlineObjectTypeNode, LazyTypeNode,
} from './ast.js';

// ─── Public entry point ────────────────────────────────────────────────────

export function generateDto(root: DtoRootNode): string {
  const needsDateTime = rootNeedsDateTime(root);
  const lines: string[] = [];

  lines.push(`import { z } from 'zod';`);
  if (needsDateTime) lines.push(`import { DateTime } from 'luxon';`);
  lines.push('');

  for (const model of root.models) {
    lines.push(...generateModel(model, root));
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Model ─────────────────────────────────────────────────────────────────

function generateModel(model: ModelNode, root: DtoRootNode): string[] {
  const hasVisibility = model.fields.some(f => f.visibility !== 'normal');

  if (hasVisibility) {
    return generateThreeSchemaModel(model, root);
  }
  return generateSimpleModel(model, root);
}

function generateSimpleModel(model: ModelNode, _root: DtoRootNode): string[] {
  const lines: string[] = [];

  if (model.description) {
    lines.push(`/** ${model.description} */`);
  }

  const body = renderFields(model.fields, 0);

  if (model.base) {
    lines.push(`export const ${model.name} = ${model.base}.extend({`);
    lines.push(...body.map(l => `    ${l}`));
    lines.push(`});`);
  } else {
    lines.push(`export const ${model.name} = z.strictObject({`);
    lines.push(...body.map(l => `    ${l}`));
    lines.push(`});`);
  }

  lines.push(`export type ${model.name} = z.infer<typeof ${model.name}>;`);
  return lines;
}

function generateThreeSchemaModel(model: ModelNode, _root: DtoRootNode): string[] {
  const lines: string[] = [];
  const name = model.name;

  // Base schema — all fields
  const allFields = model.fields;
  const baseBody = renderFields(allFields, 0);

  if (model.description) lines.push(`/** ${model.description} */`);

  if (model.base) {
    lines.push(`const ${name}Base = ${model.base}Base.extend({`);
  } else {
    lines.push(`const ${name}Base = z.strictObject({`);
  }
  lines.push(...baseBody.map(l => `    ${l}`));
  lines.push(`});`);
  lines.push('');

  // Read schema — omit writeonly fields
  const readFields = allFields.filter(f => f.visibility !== 'writeonly');
  const readBody = renderFields(readFields, 0);
  lines.push(`export const ${name} = z.strictObject({`);
  lines.push(...readBody.map(l => `    ${l}`));
  lines.push(`});`);
  lines.push(`export type ${name} = z.infer<typeof ${name}>;`);
  lines.push('');

  // Write schema — omit readonly fields
  const writeFields = allFields.filter(f => f.visibility !== 'readonly');
  const writeBody = renderFields(writeFields, 0);
  lines.push(`export const ${name}Input = z.strictObject({`);
  lines.push(...writeBody.map(l => `    ${l}`));
  lines.push(`});`);
  lines.push(`export type ${name}Input = z.infer<typeof ${name}Input>;`);

  return lines;
}

// ─── Fields ────────────────────────────────────────────────────────────────

function renderFields(fields: FieldNode[], _depth: number): string[] {
  return fields.map(f => renderField(f));
}

function renderField(field: FieldNode): string {
  let expr = renderType(field.type);

  if (field.nullable) expr += '.nullable()';
  if (field.default !== undefined) {
    const dv = typeof field.default === 'string' ? `"${field.default}"` : String(field.default);
    expr += `.default(${dv})`;
  } else if (field.optional) {
    expr += '.optional()';
  }
  if (field.description) expr += `.describe("${field.description}")`;

  return `${field.name}: ${expr},`;
}

// ─── Type rendering ────────────────────────────────────────────────────────

export function renderType(type: DtoTypeNode): string {
  switch (type.kind) {
    case 'scalar':  return renderScalar(type);
    case 'array':   return renderArray(type);
    case 'tuple':   return renderTuple(type);
    case 'record':  return renderRecord(type);
    case 'enum':    return renderEnum(type);
    case 'literal': return renderLiteral(type);
    case 'union':   return renderUnion(type);
    case 'ref':     return type.name;
    case 'lazy':    return `z.lazy(() => ${renderType(type.inner)})`;
    case 'inlineObject': return renderInlineObject(type);
    default:        return 'z.unknown()';
  }
}

function renderScalar(s: ScalarTypeNode): string {
  switch (s.name) {
    case 'string': {
      let e = 'z.string()';
      if (s.min !== undefined && s.max !== undefined) e += `.min(${s.min}).max(${s.max})`;
      else if (s.min !== undefined) e += `.min(${s.min})`;
      else if (s.max !== undefined) e += `.max(${s.max})`;
      if (s.len !== undefined) e += `.length(${s.len})`;
      if (s.regex) e += `.regex(/^${s.regex}$/)`;
      return e;
    }
    case 'number': {
      let e = 'z.number()';
      if (s.min !== undefined) e += `.min(${s.min})`;
      if (s.max !== undefined) e += `.max(${s.max})`;
      return e;
    }
    case 'int': {
      let e = 'z.int()';
      if (s.min !== undefined) e += `.min(${s.min})`;
      if (s.max !== undefined) e += `.max(${s.max})`;
      return e;
    }
    case 'bigint': {
      let e = 'z.bigint()';
      if (s.min !== undefined) e += `.min(${s.min}n)`;
      if (s.max !== undefined) e += `.max(${s.max}n)`;
      return e;
    }
    case 'boolean':  return 'z.boolean()';
    case 'date':
    case 'datetime': return `z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' })`;
    case 'email':    return 'z.email()';
    case 'url':      return 'z.url()';
    case 'uuid':     return 'z.uuid()';
    case 'any':      return 'z.any()';
    case 'unknown':  return 'z.unknown()';
    case 'null':     return 'z.null()';
    case 'object':   return 'z.record(z.string(), z.unknown())';
    case 'binary':   return 'z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: \'Must be binary data\' })';
    default:         return 'z.unknown()';
  }
}

function renderArray(a: ArrayTypeNode): string {
  let e = `z.array(${renderType(a.item)})`;
  if (a.min !== undefined) e += `.min(${a.min})`;
  if (a.max !== undefined) e += `.max(${a.max})`;
  return e;
}

function renderTuple(t: TupleTypeNode): string {
  return `z.tuple([${t.items.map(renderType).join(', ')}])`;
}

function renderRecord(r: RecordTypeNode): string {
  return `z.record(${renderType(r.key)}, ${renderType(r.value)})`;
}

function renderEnum(e: EnumTypeNode): string {
  const vals = e.values.map(v => `"${v}"`).join(', ');
  return `z.enum([${vals}])`;
}

function renderLiteral(l: LiteralTypeNode): string {
  if (typeof l.value === 'string') return `z.literal("${l.value}")`;
  return `z.literal(${l.value})`;
}

function renderUnion(u: UnionTypeNode): string {
  return `z.union([${u.members.map(renderType).join(', ')}])`;
}

function renderInlineObject(o: InlineObjectTypeNode): string {
  const fields = o.fields.map(f => `    ${renderField(f)}`).join('\n');
  return `z.strictObject({\n${fields}\n})`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function rootNeedsDateTime(root: DtoRootNode): boolean {
  return root.models.some(m =>
    m.fields.some(f => typeNeedsDateTime(f.type))
  );
}

function typeNeedsDateTime(type: DtoTypeNode): boolean {
  switch (type.kind) {
    case 'scalar': return type.name === 'date' || type.name === 'datetime';
    case 'array':  return typeNeedsDateTime(type.item);
    case 'union':  return type.members.some(typeNeedsDateTime);
    case 'inlineObject': return type.fields.some(f => typeNeedsDateTime(f.type));
    default: return false;
  }
}
