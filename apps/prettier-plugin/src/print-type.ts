import type { DtoTypeNode, FieldNode, InlineObjectTypeNode } from 'contract-dsl/src/ast.js';

// ─── Type expression printer ────────────────────────────────────────────────

export function printType(type: DtoTypeNode): string {
  switch (type.kind) {
    case 'scalar': {
      const constraints: string[] = [];
      if (type.format !== undefined) {
        // Print unquoted when format contains only safe chars; quote otherwise
        const fmt = type.format;
        constraints.push(/^[a-zA-Z0-9\-.:\/]+$/.test(fmt) ? fmt : `"${fmt}"`);
      }
      if (type.min !== undefined) constraints.push(`min=${type.min}`);
      if (type.max !== undefined) constraints.push(`max=${type.max}`);
      if (type.len !== undefined) constraints.push(`len=${type.len}`);
      if (type.regex !== undefined) constraints.push(`regex=/${type.regex}/`);
      return constraints.length > 0
        ? `${type.name}(${constraints.join(', ')})`
        : type.name;
    }
    case 'array': {
      const args: string[] = [printType(type.item)];
      if (type.min !== undefined) args.push(`min=${type.min}`);
      if (type.max !== undefined) args.push(`max=${type.max}`);
      return `array(${args.join(', ')})`;
    }
    case 'tuple':
      return `tuple(${type.items.map(printType).join(', ')})`;
    case 'record':
      return `record(${printType(type.key)}, ${printType(type.value)})`;
    case 'enum':
      return `enum(${type.values.join(', ')})`;
    case 'literal':
      return typeof type.value === 'string'
        ? `literal("${type.value}")`
        : `literal(${type.value})`;
    case 'union':
      return type.members.map(printType).join(' | ');
    case 'intersection':
      return type.members.map(printType).join(' & ');
    case 'ref':
      return type.name;
    case 'inlineObject':
      return printInlineObjectCompact(type);
    case 'lazy':
      return `lazy(${printType(type.inner)})`;
  }
}

/** Compact single-line form — used when inline object appears nested inside another type. */
function printInlineObjectCompact(obj: InlineObjectTypeNode): string {
  const prefix = obj.mode ? `${obj.mode} ` : '';
  if (obj.fields.length === 0) return `${prefix}{}`;
  const parts = obj.fields.map(f => {
    const opt = f.optional ? '?' : '';
    let t = printType(f.type);
    if (f.nullable) t += ' | null';
    return `${f.name}${opt}: ${t}`;
  });
  return `${prefix}{ ${parts.join(', ')} }`;
}

// ─── Field printer ──────────────────────────────────────────────────────────

/** Print a full field declaration, including visibility, default, and inline comment. */
export function printField(field: FieldNode, indent: string): string {
  const opt = field.optional ? '?' : '';
  const vis = field.visibility !== 'normal' ? `${field.visibility} ` : '';
  const def = field.default !== undefined ? ` = ${formatDefault(field.default)}` : '';
  const comment = field.description ? ` # ${field.description}` : '';
  const innerIndent = indent + '    ';

  // Expand inline object types to multi-line — same rule as type aliases.
  // Only when there's no default and no nullable union (those can't split cleanly).
  if (!field.nullable && field.default === undefined) {
    const trailing = extractTrailingInlineObject(field.type);
    if (trailing) {
      const { prefix, inlineObj } = trailing;
      const modePart = inlineObj.mode ? `${inlineObj.mode} ` : '';
      const header = prefix
        ? `${indent}${field.name}${opt}: ${vis}${prefix} & ${modePart}{${comment}`
        : `${indent}${field.name}${opt}: ${vis}${modePart}{${comment}`;
      return [header, ...printInlineObjectExpanded(inlineObj, innerIndent), `${indent}}`].join('\n');
    }
  }

  let typeStr = printType(field.type);
  if (field.nullable) typeStr += ' | null';
  return `${indent}${field.name}${opt}: ${vis}${typeStr}${def}${comment}`;
}

/** Print inline-object fields expanded (used when an inline brace object trails a type alias). */
export function printInlineObjectExpanded(obj: InlineObjectTypeNode, indent: string): string[] {
  return obj.fields.map(f => printField(f, indent));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format a default value: quote strings that aren't valid bare identifiers. */
export function formatDefault(val: string | number | boolean): string {
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  // If it looks like a bare identifier (enum value, unquoted token), keep it bare.
  if (/^[a-zA-Z_$][a-zA-Z0-9_$\-.]*$/.test(val)) return val;
  return `"${val}"`;
}

/**
 * Detect whether the last member of a type is an inline brace object, and if so
 * return the prefix type string and the inline object for expanded printing.
 * Returns null if the type doesn't end with an inline object.
 */
export function extractTrailingInlineObject(type: DtoTypeNode): {
  prefix: string | null;
  inlineObj: InlineObjectTypeNode;
} | null {
  if (type.kind === 'inlineObject') {
    return { prefix: null, inlineObj: type };
  }
  if (type.kind === 'intersection') {
    const last = type.members[type.members.length - 1];
    if (last?.kind === 'inlineObject') {
      const prefixStr = type.members.slice(0, -1).map(printType).join(' & ');
      return { prefix: prefixStr, inlineObj: last };
    }
  }
  return null;
}
