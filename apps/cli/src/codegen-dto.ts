import type {
  DtoRootNode, ModelNode, FieldNode, DtoTypeNode,
  ScalarTypeNode, ArrayTypeNode, TupleTypeNode, RecordTypeNode,
  EnumTypeNode, LiteralTypeNode, UnionTypeNode, ModelRefTypeNode,
  InlineObjectTypeNode, LazyTypeNode,
} from './ast.js';

// ─── Public entry point ────────────────────────────────────────────────────

export function generateDto(root: DtoRootNode): string {
  const needsDateTime = rootNeedsDateTime(root);
  const externalRefs = collectExternalRefs(root);
  const lines: string[] = [];

  lines.push(`import { z } from 'zod';`);
  if (needsDateTime) lines.push(`import { DateTime } from 'luxon';`);
  for (const ref of externalRefs) {
    const moduleName = pascalToDotCase(ref);
    lines.push(`import { ${ref} } from './${moduleName}.dto.js';`);
  }
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

  lines.push(`// from ${model.name} (${model.loc.file}:${model.loc.line})`);

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

  lines.push(`// from ${model.name} (${model.loc.file}:${model.loc.line})`);

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
    const dv = typeof field.default === 'string' ? `"${escapeString(field.default)}"` : String(field.default);
    expr += `.default(${dv})`;
  } else if (field.optional) {
    expr += '.optional()';
  }
  if (field.description) expr += `.describe("${escapeString(field.description)}")`;

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
      if (s.regex) e += `.regex(/^${s.regex.replace(/\//g, '\\/')}$/)`;
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
  if (typeof l.value === 'string') return `z.literal("${escapeString(l.value)}")`;
  return `z.literal(${l.value})`;
}

function renderUnion(u: UnionTypeNode): string {
  return `z.union([${u.members.map(renderType).join(', ')}])`;
}

function renderInlineObject(o: InlineObjectTypeNode): string {
  const fields = o.fields.map(f => `    ${renderField(f)}`).join('\n');
  return `z.strictObject({\n${fields}\n})`;
}

// ─── String escaping ──────────────────────────────────────────────────────

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
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

function collectExternalRefs(root: DtoRootNode): string[] {
  const localNames = new Set(root.models.map(m => m.name));
  const refs = new Set<string>();

  for (const model of root.models) {
    if (model.base && !localNames.has(model.base)) refs.add(model.base);
    for (const field of model.fields) {
      collectTypeRefs(field.type, refs);
    }
  }

  for (const name of localNames) refs.delete(name);
  return [...refs].sort();
}

function collectTypeRefs(type: DtoTypeNode, out: Set<string>): void {
  switch (type.kind) {
    case 'ref':          out.add(type.name); break;
    case 'array':        collectTypeRefs(type.item, out); break;
    case 'tuple':        type.items.forEach(t => collectTypeRefs(t, out)); break;
    case 'record':       collectTypeRefs(type.key, out); collectTypeRefs(type.value, out); break;
    case 'union':        type.members.forEach(t => collectTypeRefs(t, out)); break;
    case 'lazy':         collectTypeRefs(type.inner, out); break;
    case 'inlineObject': type.fields.forEach(f => collectTypeRefs(f.type, out)); break;
  }
}

/** Convert PascalCase to dot-separated lowercase: CounterpartyAccount → counterparty.account */
export function pascalToDotCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase();
}
