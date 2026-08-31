import type { ContractTypeNode, FieldNode, InlineObjectTypeNode } from '../ast.js';
import { INDENT } from './indent.js';

// ─── Type expression printer ────────────────────────────────────────────────

/** Render a `ContractTypeNode` back to its `.ck` source string. */
export function printType(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar': {
            const constraints: string[] = [];
            if (type.format !== undefined) {
                // Print unquoted when format contains only safe chars; quote otherwise
                const fmt = type.format;
                constraints.push(/^[a-zA-Z0-9\-.:/]+$/.test(fmt) ? fmt : `"${fmt}"`);
            }
            if (type.min !== undefined) constraints.push(`min=${type.min}`);
            if (type.max !== undefined) constraints.push(`max=${type.max}`);
            if (type.len !== undefined) constraints.push(`len=${type.len}`);
            if (type.scale !== undefined) constraints.push(`scale=${type.scale}`);
            if (type.regex !== undefined) constraints.push(`regex=${printRegex(type.regex)}`);
            return constraints.length > 0 ? `${type.name}(${constraints.join(', ')})` : type.name;
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
            return `enum(${type.values.map(formatEnumValue).join(', ')})`;
        case 'literal':
            return typeof type.value === 'string' ? `literal(${quoteString(type.value)})` : `literal(${type.value})`;
        case 'union':
            return type.members.map(printType).join(' | ');
        case 'discriminatedUnion':
            return `discriminated(by=${type.discriminator}, ${type.members.map(printType).join(' | ')})`;
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
    const prefix = obj.mode ? `mode(${obj.mode}) ` : '';
    if (obj.fields.length === 0) return `${prefix}{}`;
    const parts = obj.fields.map(f => {
        const opt = f.optional ? '?' : '';
        let t = printType(f.type);
        if (f.nullable) t += ' | null';
        return `${f.name}${opt}: ${t}`;
    });
    return `${prefix}{ ${parts.join(', ')} }`;
}

/** Multi-line enum form — one value per line, used when single-line would exceed print width. */
export function printEnumExpanded(values: string[], indent: string): string {
    const innerIndent = indent + INDENT;
    return `enum(\n${values.map(v => `${innerIndent}${formatEnumValue(v)}`).join(',\n')}\n${indent})`;
}

// ─── Field printer ──────────────────────────────────────────────────────────

/** Print a full field declaration, including visibility, default, and inline comment.
 * Modifier order is canonical: override → deprecated → readonly|writeonly → type. */
export function printField(field: FieldNode, indent: string, printWidth: number = 80): string {
    const opt = field.optional ? '?' : '';
    const ovr = field.override ? 'override ' : '';
    const dep = field.deprecated ? 'deprecated ' : '';
    const vis = field.visibility !== 'normal' ? `${field.visibility} ` : '';
    const mods = `${ovr}${dep}${vis}`;
    const def = field.default !== undefined ? ` = ${formatDefault(field.default)}` : '';
    const comment = field.description ? ` # ${inlineComment(field.description)}` : '';
    const innerIndent = indent + INDENT;

    // Expand inline object types to multi-line — same rule as type aliases.
    // Only when there's no default and no nullable union (those can't split cleanly).
    if (!field.nullable && field.default === undefined) {
        const trailing = extractTrailingInlineObject(field.type);
        if (trailing) {
            const { prefix, inlineObj } = trailing;
            const modePart = inlineObj.mode ? `mode(${inlineObj.mode}) ` : '';
            const header = prefix
                ? `${indent}${field.name}${opt}: ${mods}${prefix} & ${modePart}{${comment}`
                : `${indent}${field.name}${opt}: ${mods}${modePart}{${comment}`;
            return [header, ...printInlineObjectExpanded(inlineObj, innerIndent, printWidth), `${indent}}`].join('\n');
        }
    }

    let typeStr = printType(field.type);
    if (field.nullable) typeStr += ' | null';
    const fullLine = `${indent}${field.name}${opt}: ${mods}${typeStr}${def}${comment}`;
    if (field.type.kind === 'enum' && !field.nullable && field.default === undefined && fullLine.length > printWidth) {
        const enumStr = printEnumExpanded(field.type.values, indent);
        return `${indent}${field.name}${opt}: ${mods}${enumStr}${comment}`;
    }
    return fullLine;
}

/** Print inline-object fields expanded (used when an inline brace object trails a type alias).
 * Any `trailingComments` (comments after the last field, before `}`) are emitted as indented
 * `# text` lines after the fields, matching how model bodies round-trip trailing comments. */
export function printInlineObjectExpanded(obj: InlineObjectTypeNode, indent: string, printWidth: number = 80): string[] {
    const lines = obj.fields.map(f => printField(f, indent, printWidth));
    for (const comment of obj.trailingComments ?? []) {
        lines.push(`${indent}# ${comment}`);
    }
    return lines;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Flatten text to a single line so it is safe to embed in a trailing `# ...` comment.
 *
 * `comment = "#" (~"\n" any)* ("\n" | end)` — a comment runs to end of line, so an embedded
 * newline terminates it and dumps the remainder of the text as raw `.ck` source, which does not
 * parse. Text parsed from a `.ck` file can never contain one, but a description lifted from an
 * OpenAPI spec routinely does, and `printCk` prints programmatically built nodes as readily as
 * parsed ones. Comment blocks printed *above* a declaration split on newlines instead and need
 * no flattening.
 */
export function inlineComment(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Wrap a string in the quote style it can actually survive.
 *
 * `.ck` string literals have no escape sequences (`stringLit` in the grammar is
 * `"\"" doubleStringChar* "\""` or `"'" singleStringChar* "'"`), so the quote character is
 * chosen to avoid the content rather than escaped inside it. A value containing *both* quote
 * styles is unrepresentable; it cannot come from `parseCk` for the same no-escapes reason, so
 * it only arises from a programmatically built AST. Rather than emit source that will not
 * parse, the conflicting inner quote is replaced — producers that can warn (`openapi-to-ck`)
 * check for this case before printing.
 */
export function quoteString(v: string): string {
    if (!v.includes('"')) return `"${v}"`;
    if (!v.includes("'")) return `'${v}'`;
    return `"${v.replace(/"/g, "'")}"`;
}

/** True when a string contains both quote styles, so no `.ck` string literal can hold it. */
export function isUnquotable(v: string): boolean {
    return v.includes('"') && v.includes("'");
}

/**
 * Render a `regex=` constraint value.
 *
 * The regex literal is delimited by `/` and `regexChar` excludes it, so a pattern containing a
 * slash has to go through `ArgValue`'s `stringLit` alternative instead. Both forms parse to the
 * same `ScalarTypeNode.regex`, which stores the pattern without delimiters.
 */
export function printRegex(pattern: string): string {
    return pattern.includes('/') ? quoteString(pattern) : `/${pattern}/`;
}

/** Format a single enum value: bare identifier stays bare; anything else gets quoted. */
export function formatEnumValue(v: string): string {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$\-.]*$/.test(v)) return v;
    return quoteString(v);
}

/** Format a default value: quote strings that aren't valid bare identifiers. */
export function formatDefault(val: string | number | boolean): string {
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    // If it looks like a bare identifier (enum value, unquoted token), keep it bare.
    if (/^[a-zA-Z_$][a-zA-Z0-9_$\-.]*$/.test(val)) return val;
    return quoteString(val);
}

/**
 * Detect whether the last member of a type is an inline brace object, and if so
 * return the prefix type string and the inline object for expanded printing.
 * Returns null if the type doesn't end with an inline object.
 */
export function extractTrailingInlineObject(type: ContractTypeNode): {
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
