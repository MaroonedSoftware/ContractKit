/**
 * Identifier and file-name conversions for Kotlin output.
 *
 * Kept separate from the codegen modules because both the model and the client generators
 * need the same conversions, and a mismatch between them would produce a client that
 * references a property name the model never declared.
 */

/**
 * Kotlin's hard keywords — reserved everywhere, so an identifier that collides with one has to be
 * backtick-escaped. Soft keywords (`by`, `where`, `field`, …) and modifier keywords (`open`,
 * `data`, `inline`, …) are context-sensitive and legal as plain identifiers, so they're absent.
 */
export const KOTLIN_HARD_KEYWORDS: ReadonlySet<string> = new Set([
    'as',
    'break',
    'class',
    'continue',
    'do',
    'else',
    'false',
    'for',
    'fun',
    'if',
    'in',
    'interface',
    'is',
    'null',
    'object',
    'package',
    'return',
    'super',
    'this',
    'throw',
    'true',
    'try',
    'typealias',
    'typeof',
    'val',
    'var',
    'when',
    'while',
]);

/**
 * Wrap `name` in backticks when it is a Kotlin hard keyword, so it can still be used as a
 * property, parameter, or function name. Backticks rather than a suffix: the wire name and the
 * Kotlin name stay identical, which keeps `@SerialName` off the field and the SDK method named
 * exactly what the contract's `sdk:` said.
 */
export function escapeKotlinIdentifier(name: string): string {
    return KOTLIN_HARD_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

/**
 * Convert a contract field or parameter name to a valid Kotlin property name in camelCase.
 *
 * Separators (`-`, `_`, `.`, spaces) introduce a word boundary and are dropped;
 * `x-request-id` becomes `xRequestId`. A leading digit gets an underscore prefix, since Kotlin
 * identifiers cannot start with one. The result is keyword-escaped.
 *
 * The original name is preserved on the wire through `@SerialName`, so this conversion is free to
 * be lossy as long as it is deterministic.
 */
export function toKotlinPropertyName(name: string): string {
    const words = splitWords(name);
    if (words.length === 0) return '_';
    const head = words[0]!.toLowerCase();
    const rest = words.slice(1).map(capitalize);
    let result = head + rest.join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return escapeKotlinIdentifier(result);
}

/**
 * Convert a name to a Kotlin type name in PascalCase. Never backtick-escaped: type names are
 * generated (from model names, method names, or status codes) rather than taken verbatim, so a
 * collision with a keyword is a naming bug worth surfacing rather than papering over.
 */
export function toKotlinTypeName(name: string): string {
    const words = splitWords(name);
    if (words.length === 0) return '_';
    let result = words.map(capitalize).join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Convert an enum member value to a Kotlin enum entry name in SCREAMING_SNAKE_CASE.
 * The value itself always travels via `@SerialName`, so this only has to be a stable identifier.
 */
export function toKotlinEnumEntryName(value: string): string {
    const words = splitWords(value);
    if (words.length === 0) return '_';
    let result = words.map(w => w.toUpperCase()).join('_');
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Derive the PascalCase base used for a generated file's names from a `.ck` file path:
 * `"ledger.categories.ck"` → `"LedgerCategories"`. Both the models file and the client class
 * for one source file are named from this, so they stay visibly paired in the output tree.
 */
export function deriveKotlinFileBase(file: string): string {
    const base =
        file
            .split('/')
            .pop()
            ?.replace(/\.(op\.)?ck$/, '') ?? 'models';
    return toKotlinTypeName(base);
}

/**
 * Render `text` as a KDoc block indented by `indent`. Returns `[]` for empty text so callers can
 * splat unconditionally. A comment terminator inside the text would close the block early, so it
 * is broken up.
 */
export function kdocLines(text: string, indent: string): string[] {
    const safe = text.replace(/\*\//g, '*\\/');
    const sourceLines = safe.split('\n');
    if (sourceLines.length === 1) return [`${indent}/** ${sourceLines[0]} */`];
    return [`${indent}/**`, ...sourceLines.map(line => `${indent} * ${line}`.trimEnd()), `${indent} */`];
}

/**
 * Split an identifier into words on separators and camelCase boundaries.
 * `"x-request-id"` → `["x", "request", "id"]`; `"createdAt"` → `["created", "At"]`;
 * `"myHTTPClient"` → `["my", "HTTP", "Client"]`.
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
