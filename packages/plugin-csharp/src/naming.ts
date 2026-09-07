/**
 * Identifier and file-name conversions for C# output.
 *
 * Kept separate from the codegen modules because both the model and the client generators need the
 * same conversions, and a mismatch between them would produce a client that references a property
 * name the model never declared.
 */

/**
 * C#'s reserved keywords — illegal as bare identifiers anywhere, so a name that collides with one
 * has to be escaped with `@`. Contextual keywords (`record`, `required`, `init`, `value`, `var`,
 * `async`, `await`, `yield`, `nameof`, `when`) are legal identifiers and are deliberately absent:
 * escaping them would only make the generated code noisier.
 */
export const CSHARP_KEYWORDS: ReadonlySet<string> = new Set([
    'abstract',
    'as',
    'base',
    'bool',
    'break',
    'byte',
    'case',
    'catch',
    'char',
    'checked',
    'class',
    'const',
    'continue',
    'decimal',
    'default',
    'delegate',
    'do',
    'double',
    'else',
    'enum',
    'event',
    'explicit',
    'extern',
    'false',
    'finally',
    'fixed',
    'float',
    'for',
    'foreach',
    'goto',
    'if',
    'implicit',
    'in',
    'int',
    'interface',
    'internal',
    'is',
    'lock',
    'long',
    'namespace',
    'new',
    'null',
    'object',
    'operator',
    'out',
    'override',
    'params',
    'private',
    'protected',
    'public',
    'readonly',
    'ref',
    'return',
    'sbyte',
    'sealed',
    'short',
    'sizeof',
    'stackalloc',
    'static',
    'string',
    'struct',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'uint',
    'ulong',
    'unchecked',
    'unsafe',
    'ushort',
    'using',
    'virtual',
    'void',
    'volatile',
    'while',
]);

/**
 * Members the C# compiler already declares on a record, plus the ones a record's synthesized
 * members would collide with. A contract field landing on any of these has to be renamed.
 */
const RESERVED_MEMBER_NAMES: ReadonlySet<string> = new Set(['Equals', 'GetHashCode', 'GetType', 'ToString', 'EqualityContract', 'PrintMembers']);

/**
 * Prefix `name` with `@` when it is a C# keyword, so it can still be used as a parameter or local.
 * The `@` is a lexical escape only: the identifier is still spelled `name` everywhere it matters,
 * including in `nameof` and in reflection, so nothing downstream has to know about it.
 */
export function escapeCSharpIdentifier(name: string): string {
    return CSHARP_KEYWORDS.has(name) ? `@${name}` : name;
}

/**
 * Convert a contract field name to a C# property name in PascalCase.
 *
 * Separators (`-`, `_`, `.`, spaces) introduce a word boundary and are dropped, so `x-request-id`
 * becomes `XRequestId`. A leading digit gets an underscore prefix, since C# identifiers cannot
 * start with one. No keyword escaping is needed: every C# keyword is lowercase and this always
 * produces an initial capital.
 *
 * The original name is preserved on the wire through `[JsonPropertyName]`, so this conversion is
 * free to be lossy as long as it is deterministic.
 */
export function toCSharpPropertyName(name: string): string {
    const words = splitWords(name);
    if (words.length === 0) return '_';
    let result = words.map(capitalize).join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Convert a contract parameter or path placeholder to a C# parameter name in camelCase:
 * `invoice-id` becomes `invoiceId`. Keyword-escaped, because camelCase lands on keywords
 * regularly — a path parameter named `event` or `params` is ordinary in a contract.
 */
export function toCSharpParameterName(name: string): string {
    const words = splitWords(name);
    if (words.length === 0) return '_';
    const head = words[0]!.toLowerCase();
    const rest = words.slice(1).map(capitalize);
    let result = head + rest.join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return escapeCSharpIdentifier(result);
}

/**
 * Make a property name safe inside `ownerTypeName`.
 *
 * C# rejects a member whose name matches its enclosing type (CS0542), which a contract hits
 * whenever a model has a field of its own name — `contract Invoice { invoice: ... }`. A record also
 * synthesizes members that a contract field can collide with. Both are resolved by appending
 * `Value`; the wire name is unaffected, since `[JsonPropertyName]` is always emitted.
 */
export function safeMemberName(propertyName: string, ownerTypeName: string): string {
    if (propertyName === ownerTypeName || RESERVED_MEMBER_NAMES.has(propertyName)) return `${propertyName}Value`;
    return propertyName;
}

/**
 * Convert a name to a C# type name in PascalCase. Never escaped: type names are generated (from
 * model names, method names, or status codes) rather than taken verbatim, so a collision with a
 * keyword is a naming bug worth surfacing rather than papering over.
 */
export function toCSharpTypeName(name: string): string {
    const words = splitWords(name);
    if (words.length === 0) return '_';
    let result = words.map(capitalize).join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Make an already-composed name safe to use as a C# type name, without re-casing it.
 *
 * Distinct from {@link toCSharpTypeName}, which splits a source name into words and rebuilds it:
 * running that over a name already assembled from PascalCase parts would fold `MV` back to `Mv`.
 */
export function sanitizeCSharpTypeName(name: string): string {
    let result = name.replace(/[^a-zA-Z0-9]/g, '');
    if (result.length === 0) return '_';
    result = result.charAt(0).toUpperCase() + result.slice(1);
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Convert an enum member value to a C# enum member name in PascalCase: `in-progress` becomes
 * `InProgress`. The value itself always travels via `[JsonStringEnumMemberName]`, so this only has
 * to be a stable identifier.
 */
export function toCSharpEnumMemberName(value: string): string {
    const words = splitWords(value);
    if (words.length === 0) return '_';
    let result = words.map(capitalize).join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Derive the PascalCase base used for a generated file's names from a `.ck` file path:
 * `"ledger.categories.ck"` becomes `"LedgerCategories"`. Both the models file and the client class
 * for one source file are named from this, so they stay visibly paired in the output tree.
 */
export function deriveCSharpFileBase(file: string): string {
    const base =
        file
            .split('/')
            .pop()
            ?.replace(/\.(op\.)?ck$/, '') ?? 'models';
    return toCSharpTypeName(base);
}

/**
 * Render `text` as an XML doc comment indented by `indent`, wrapped in `tag`. Returns `[]` for
 * empty text so callers can splat unconditionally.
 *
 * `///` is a line comment, so unlike Kotlin's KDoc there is no delimiter to break out of. What does
 * have to be handled is XML: an unescaped `&` or `<` in a description makes the doc file malformed,
 * which the compiler reports as a warning and `-warnaserror` turns into a build failure.
 */
export function xmlDocLines(text: string, indent: string, tag = 'summary'): string[] {
    if (text.length === 0) return [];
    const safe = escapeXml(text);
    const sourceLines = safe.split('\n');
    if (sourceLines.length === 1) return [`${indent}/// <${tag}>${sourceLines[0]}</${tag}>`];
    return [`${indent}/// <${tag}>`, ...sourceLines.map(line => `${indent}/// ${line}`.trimEnd()), `${indent}/// </${tag}>`];
}

/** Escape the three characters that would otherwise make a doc comment malformed XML. */
export function escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render `value` as a C# string literal. No `$` handling: interpolated strings are the only place
 * `$` is special, and no generated literal built from contract text is interpolated.
 */
export function quoteCSharpString(value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/\0/g, '\\0');
    return `"${escaped}"`;
}

/**
 * Split an identifier into words on separators and camelCase boundaries.
 * `"x-request-id"` becomes `["x", "request", "id"]`; `"createdAt"` becomes `["created", "At"]`;
 * `"myHTTPClient"` becomes `["my", "HTTP", "Client"]`.
 */
function splitWords(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
