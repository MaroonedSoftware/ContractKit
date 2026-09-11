/**
 * Identifier and file-name conversions for Swift output.
 *
 * Kept separate from the codegen modules because both the model and the client generators need
 * the same conversions, and a mismatch between them would produce a client that references a
 * property name the model never declared.
 */

/**
 * Swift's reserved words — the ones the compiler rejects as a bare identifier, so a name that
 * collides with one has to be backtick-escaped. Contextual keywords (`async`, `lazy`, `get`,
 * `set`, `final`, `some`, …) are legal as plain identifiers, so they are absent.
 */
export const SWIFT_RESERVED_WORDS: ReadonlySet<string> = new Set([
    // declarations
    'associatedtype',
    'class',
    'deinit',
    'enum',
    'extension',
    'fileprivate',
    'func',
    'import',
    'init',
    'inout',
    'internal',
    'let',
    'open',
    'operator',
    'private',
    'precedencegroup',
    'protocol',
    'public',
    'rethrows',
    'static',
    'struct',
    'subscript',
    'typealias',
    'var',
    // statements
    'break',
    'case',
    'catch',
    'continue',
    'default',
    'defer',
    'do',
    'else',
    'fallthrough',
    'for',
    'guard',
    'if',
    'in',
    'repeat',
    'return',
    'switch',
    'where',
    'while',
    // expressions and types
    'Any',
    'as',
    'await',
    'false',
    'is',
    'nil',
    'self',
    'Self',
    'super',
    'throw',
    'throws',
    'true',
    'try',
]);

/**
 * Names that backticks do not reliably rescue: `self` and `init` keep their meaning in member
 * position even when escaped, and `Type`/`Protocol` are metatype selectors after a dot. These get
 * an underscore suffix instead; the wire name is unaffected because every generated struct spells
 * its keys out in `CodingKeys`.
 */
const HARD_RENAMES: ReadonlySet<string> = new Set(['self', 'Self', 'init', 'Type', 'Protocol']);

/**
 * Type names the generated code refers to unqualified. A contract that claims one of these would
 * shadow it for the whole module — a model named `Error` breaks every `throws` in the client, and
 * one named `SdkHttp` replaces the runtime — so the plugin rejects them up front instead of
 * emitting Swift that fails in a way the contract author cannot trace back.
 */
export const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
    // Swift standard library and Foundation
    'Any',
    'AnyObject',
    'Array',
    'Bool',
    'Character',
    'Codable',
    'CodingKey',
    'Data',
    'Date',
    'Decodable',
    'Decoder',
    'DecodingError',
    'Dictionary',
    'Double',
    'Encodable',
    'Encoder',
    'EncodingError',
    'Equatable',
    'Error',
    'Float',
    'Hashable',
    'Int',
    'Int64',
    'Never',
    'Optional',
    'Result',
    'Sendable',
    'Set',
    'String',
    'Task',
    'URL',
    'URLRequest',
    'URLSession',
    'UUID',
    'Void',
    // the generated runtime
    'BigIntValue',
    'DecimalValue',
    'DynamicCodingKey',
    'HTTPTransport',
    'HeaderDecodable',
    'Indirect',
    'IsoDuration',
    'JSONValue',
    'LocalDate',
    'LocalTime',
    'MultipartPart',
    'SdkConfig',
    'SdkError',
    'SdkHttp',
    'SdkJSON',
    'SdkRequest',
    'SdkResponse',
    'URLSessionTransport',
]);

/**
 * Make `name` usable as a Swift property, parameter, case, or function name: backticks around a
 * reserved word, an underscore after a hard-rename. Backticks rather than a suffix wherever
 * possible: the Swift name and the wire name stay identical, so the SDK method is named exactly
 * what the contract's `sdk:` said.
 */
export function escapeSwiftIdentifier(name: string): string {
    if (HARD_RENAMES.has(name)) return `${name}_`;
    return SWIFT_RESERVED_WORDS.has(name) ? `\`${name}\`` : name;
}

/**
 * Convert a contract field or parameter name to a valid Swift property name in lowerCamelCase.
 *
 * Separators (`-`, `_`, `.`, spaces) introduce a word boundary and are dropped; `x-request-id`
 * becomes `xRequestId`. A leading digit gets an underscore prefix, since Swift identifiers cannot
 * start with one. The result is keyword-escaped.
 *
 * The original name is preserved on the wire through `CodingKeys`, so this conversion is free to
 * be lossy as long as it is deterministic.
 */
export function toSwiftPropertyName(name: string): string {
    const words = splitWords(name);
    if (words.length === 0) return 'underscore';
    const head = words[0]!.toLowerCase();
    const rest = words.slice(1).map(capitalize);
    let result = head + rest.join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return escapeSwiftIdentifier(result);
}

/**
 * A Swift parameter name for each declared name, keyed by that name.
 *
 * Each goes through {@link toSwiftPropertyName}, then gains a `_` until it collides with neither
 * one of `taken` nor another name's result, and is escaped last. The comparison is on the
 * unescaped spelling, since `` `class` `` and `class` name the same identifier. Returns the plain
 * conversion in the common case, so existing output stays byte-identical.
 *
 * @param taken Unescaped identifiers the surrounding generated code already binds or reads, which
 * a declared name must not duplicate or shadow.
 */
export function bindSwiftParameterNames(names: readonly string[], taken: Iterable<string>): Map<string, string> {
    const unavailable = new Set<string>(taken);
    const bindings = new Map<string, string>();
    for (const name of names) {
        let local = toSwiftPropertyName(name).replace(/`/g, '');
        while (unavailable.has(local)) local += '_';
        unavailable.add(local);
        bindings.set(name, escapeSwiftIdentifier(local));
    }
    return bindings;
}

/**
 * Convert a name to a Swift type name in UpperCamelCase. Never backtick-escaped: type names are
 * generated (from model names, method names, or status codes) rather than taken verbatim, so a
 * collision with a keyword is a naming bug worth surfacing rather than papering over.
 */
export function toSwiftTypeName(name: string): string {
    const words = splitWords(name);
    if (words.length === 0) return '_';
    let result = words.map(capitalize).join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Make an already-composed name safe to use as a Swift type name, without re-casing it.
 *
 * Distinct from {@link toSwiftTypeName}, which splits a source name into words and rebuilds it:
 * running that over a name already assembled from UpperCamelCase parts would fold `MV` back to `Mv`.
 */
export function sanitizeSwiftTypeName(name: string): string {
    let result = name.replace(/[^a-zA-Z0-9]/g, '');
    if (result.length === 0) return '_';
    result = result.charAt(0).toUpperCase() + result.slice(1);
    if (/^\d/.test(result)) result = `_${result}`;
    return result;
}

/**
 * Convert an enum member value, or a union member label, to a Swift `case` name in lowerCamelCase.
 * The value itself always travels as the case's raw value, so this only has to be a stable
 * identifier; an empty value becomes `blank` so the case still has a name.
 */
export function toSwiftCaseName(value: string): string {
    const words = splitWords(value);
    if (words.length === 0) return 'blank';
    const head = words[0]!.toLowerCase();
    let result = head + words.slice(1).map(capitalize).join('');
    if (/^\d/.test(result)) result = `_${result}`;
    return escapeSwiftIdentifier(result);
}

/**
 * Derive the UpperCamelCase base used for a generated file's names from a `.ck` file path:
 * `"ledger.categories.ck"` → `"LedgerCategories"`. Both the models file and the client class for
 * one source file are named from this, so they stay visibly paired in the output tree.
 */
export function deriveSwiftFileBase(file: string): string {
    const base =
        file
            .split('/')
            .pop()
            ?.replace(/\.(op\.)?ck$/, '') ?? 'models';
    return toSwiftTypeName(base);
}

/**
 * Render `text` as `///` documentation lines indented by `indent`. Returns `[]` for empty text so
 * callers can splat unconditionally. Line comments need no delimiter escaping — unlike a block
 * comment, nothing inside one can close it early — so the text goes through untouched apart from
 * a stray carriage return.
 */
export function docLines(text: string, indent: string): string[] {
    return text
        .replace(/\r/g, '')
        .split('\n')
        .map(line => `${indent}/// ${line}`.trimEnd());
}

/** Quote a string as a Swift literal. `\(` opens an interpolation, so the backslash covers it. */
export function quoteSwiftString(value: string): string {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return `"${escaped}"`;
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
