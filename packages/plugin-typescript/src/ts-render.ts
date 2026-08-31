import type { ContractTypeNode, FieldNode, ScalarTypeNode } from '@contractkit/core';

/** Declaration emitted into generated files that reference the `json` scalar. */
export const JSON_VALUE_TYPE_DECL = 'export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };';

/** Quote a property name unless it is already a valid bare TypeScript identifier. */
export function quoteKey(name: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `'${name}'`;
}

/** Escape text for safe inclusion inside a JSDoc block comment: neutralize the
 *  block-comment terminator sequence and split embedded newlines into separate
 *  ` * ` continuation lines. Returns the content lines (WITHOUT a leading prefix). */
export function escapeJsDocLines(text: string): string[] {
    return text.replace(/\*\//g, '*\\/').split('\n');
}

/** Escape a string for inclusion inside a single-quoted TypeScript string literal. */
export function escapeSingleQuoted(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** Convert an HTTP header name (e.g. `preference-applied`, `X-Request-ID`, `ETag`) to camelCase for use as a JS property. */
export function headerNameToProperty(name: string): string {
    const parts = name.split(/[-_]/).filter(Boolean);
    return parts
        .map((p, i) => {
            const lower = p.toLowerCase();
            return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join('');
}

// ─── TypeScript type rendering ────────────────────────────────────────────

/**
 * Which runtime the emitted types describe. A few scalars have no single correct TypeScript
 * type: `binary` is a `Blob` in a fetch-based client but a `Buffer` on a Node server. Everything
 * else renders identically for both targets. Defaults to `'client'`.
 */
export type TsRenderTarget = 'client' | 'server';

/**
 * Render a contract type as a plain TypeScript type expression. Model refs render as their bare
 * name; use `renderInputTsType` / `renderOutputTsType` to substitute Input/Output variants.
 *
 * @param target Runtime the type describes; only `binary` differs (`Buffer` vs `Blob`).
 */
export function renderTsType(type: ContractTypeNode, target: TsRenderTarget = 'client'): string {
    switch (type.kind) {
        case 'scalar':
            return renderTsScalar(type.name, target);
        case 'array': {
            const inner = renderTsType(type.item, target);
            const needsParens =
                type.item.kind === 'union' ||
                type.item.kind === 'discriminatedUnion' ||
                type.item.kind === 'intersection' ||
                type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'tuple':
            return `[${type.items.map(i => renderTsType(i, target)).join(', ')}]`;
        case 'record':
            return `Record<${renderTsType(type.key, target)}, ${renderTsType(type.value, target)}>`;
        case 'enum':
            return type.values.map(v => `'${escapeSingleQuoted(v)}'`).join(' | ');
        case 'literal':
            return typeof type.value === 'string' ? `'${escapeSingleQuoted(type.value)}'` : String(type.value);
        case 'union':
            return type.members.map(m => renderTsType(m, target)).join(' | ');
        case 'discriminatedUnion':
            return type.members.map(m => renderTsType(m, target)).join(' | ');
        case 'intersection':
            return type.members.map(m => renderTsType(m, target)).join(' & ');
        case 'ref':
            return type.name;
        case 'lazy':
            return renderTsType(type.inner, target);
        case 'inlineObject':
            return renderTsInlineObject(type.fields, target);
        default:
            return 'unknown';
    }
}

function renderTsScalar(name: ScalarTypeNode['name'], target: TsRenderTarget): string {
    switch (name) {
        case 'string':
        case 'email':
        case 'url':
        case 'uuid':
            return 'string';
        case 'number':
        case 'int':
            return 'number';
        case 'bigint':
            return 'bigint';
        case 'decimal':
            // The one scalar whose wire view and server view agree — see the note on this
            // function and on `serverTsScalar`. A `decimal` travels as a quoted string, and both
            // the router (via `_ZodDecimal`) and the SDK (via the generated `reviveX` functions)
            // hand the developer a real `Decimal`, so there is no `target` split to make.
            return 'Decimal';
        case 'boolean':
            return 'boolean';
        case 'date':
        case 'time':
        case 'datetime':
        case 'duration':
        case 'interval':
            return 'string';
        case 'null':
            return 'null';
        case 'unknown':
            return 'unknown';
        case 'object':
            return 'Record<string, unknown>';
        case 'binary':
            // Node servers hand the handler a Buffer (matching `_ZodBinary`); fetch clients get a Blob.
            return target === 'server' ? 'Buffer' : 'Blob';
        case 'json':
            return 'JsonValue';
        default: {
            const _exhaustive: never = name;
            throw new Error(`plugin-typescript: unmapped scalar '${String(_exhaustive)}' — add a case`);
        }
    }
}

function renderTsInlineObject(fields: FieldNode[], target: TsRenderTarget): string {
    const entries = fields.map(f => {
        const opt = f.optional ? '?' : '';
        return `${quoteKey(f.name)}${opt}: ${renderTsType(f.type, target)}`;
    });
    return `{ ${entries.join('; ')} }`;
}

/**
 * Like renderTsType, but substitutes model refs with their Input variant
 * when the model has visibility modifiers. Used for request-side types
 * (body, params, query, headers).
 *
 * @param target Runtime the type describes; only `binary` differs (`Buffer` vs `Blob`).
 */
export function renderInputTsType(type: ContractTypeNode, modelsWithInput?: Set<string>, target: TsRenderTarget = 'client'): string {
    if (!modelsWithInput || modelsWithInput.size === 0) return renderTsType(type, target);
    switch (type.kind) {
        case 'ref':
            return modelsWithInput.has(type.name) ? `${type.name}Input` : type.name;
        case 'array': {
            const inner = renderInputTsType(type.item, modelsWithInput, target);
            const needsParens =
                type.item.kind === 'union' ||
                type.item.kind === 'discriminatedUnion' ||
                type.item.kind === 'intersection' ||
                type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'intersection':
            return type.members.map(m => renderInputTsType(m, modelsWithInput, target)).join(' & ');
        case 'union':
            return type.members.map(m => renderInputTsType(m, modelsWithInput, target)).join(' | ');
        case 'discriminatedUnion':
            return type.members.map(m => renderInputTsType(m, modelsWithInput, target)).join(' | ');
        case 'inlineObject':
            return `{ ${type.fields.map(f => `${quoteKey(f.name)}${f.optional ? '?' : ''}: ${renderInputTsType(f.type, modelsWithInput, target)}`).join('; ')} }`;
        case 'lazy':
            return renderInputTsType(type.inner, modelsWithInput, target);
        default:
            return renderTsType(type, target);
    }
}

/**
 * Like renderTsType, but substitutes model refs with their Output variant
 * (post-transform wire shape) when the model has format(output=...) or
 * transitively references one. Used for response-side types in routers
 * and SDK return types.
 *
 * @param target Runtime the type describes; only `binary` differs (`Buffer` vs `Blob`).
 */
export function renderOutputTsType(type: ContractTypeNode, modelsWithOutput?: Set<string>, target: TsRenderTarget = 'client'): string {
    if (!modelsWithOutput || modelsWithOutput.size === 0) return renderTsType(type, target);
    switch (type.kind) {
        case 'ref':
            return modelsWithOutput.has(type.name) ? `${type.name}Output` : type.name;
        case 'array': {
            const inner = renderOutputTsType(type.item, modelsWithOutput, target);
            const needsParens =
                type.item.kind === 'union' ||
                type.item.kind === 'discriminatedUnion' ||
                type.item.kind === 'intersection' ||
                type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'intersection':
            return type.members.map(m => renderOutputTsType(m, modelsWithOutput, target)).join(' & ');
        case 'union':
            return type.members.map(m => renderOutputTsType(m, modelsWithOutput, target)).join(' | ');
        case 'discriminatedUnion':
            return type.members.map(m => renderOutputTsType(m, modelsWithOutput, target)).join(' | ');
        case 'inlineObject':
            return `{ ${type.fields.map(f => `${quoteKey(f.name)}${f.optional ? '?' : ''}: ${renderOutputTsType(f.type, modelsWithOutput, target)}`).join('; ')} }`;
        case 'lazy':
            return renderOutputTsType(type.inner, modelsWithOutput, target);
        default:
            return renderTsType(type, target);
    }
}
