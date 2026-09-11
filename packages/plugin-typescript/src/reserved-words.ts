import { toIdentifier } from '@contractkit/core';

/**
 * Words generated TypeScript cannot bind as a parameter or a local.
 *
 * Every file this plugin emits is an ES module, and every binding sits inside a class method or an
 * async arrow, so strict mode applies throughout: the ECMAScript reserved words, the strict-mode
 * future reserved words, `await` (reserved in modules), and `arguments` and `eval` (legal to read,
 * illegal to bind). Contextual words such as `from`, `of`, `type`, `async` and `as` stay legal and
 * are deliberately absent, so they keep their declared spelling.
 */
export const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
    'arguments',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'eval',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'implements',
    'import',
    'in',
    'instanceof',
    'interface',
    'let',
    'new',
    'null',
    'package',
    'private',
    'protected',
    'public',
    'return',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
]);

/**
 * A local identifier for each declared name, keyed by that name.
 *
 * Each name goes through `toIdentifier`, then gains a `_` until it collides with neither a
 * reserved word, one of `taken`, nor another name's binding. Returns the name unchanged in the
 * common case, so existing generated output stays byte-identical.
 *
 * Only the binding moves: a caller that needs the declared spelling somewhere (a route
 * placeholder, a schema key) still has it as the map key.
 *
 * @param taken Identifiers the surrounding generated code already binds or reads, which a
 * declared name must not shadow.
 * @param reserved Words no binding may take. Defaults to {@link JS_RESERVED_WORDS}; pass an empty
 * set when the result is a property key rather than a binding, since a key may be a keyword.
 */
export function bindIdentifiers(
    names: readonly string[],
    taken: Iterable<string>,
    reserved: ReadonlySet<string> = JS_RESERVED_WORDS,
): Map<string, string> {
    const unavailable = new Set<string>([...reserved, ...taken]);
    const bindings = new Map<string, string>();
    for (const name of names) {
        let local = toIdentifier(name);
        while (unavailable.has(local)) local += '_';
        unavailable.add(local);
        bindings.set(name, local);
    }
    return bindings;
}
