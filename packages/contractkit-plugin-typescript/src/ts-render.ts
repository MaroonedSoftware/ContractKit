import type { ContractTypeNode, FieldNode } from '@maroonedsoftware/contractkit';

export const JSON_VALUE_TYPE_DECL = 'export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };';

export function quoteKey(name: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `'${name}'`;
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

export function renderTsType(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return renderTsScalar(type.name);
        case 'array': {
            const inner = renderTsType(type.item);
            const needsParens =
                type.item.kind === 'union' || type.item.kind === 'discriminatedUnion' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'tuple':
            return `[${type.items.map(renderTsType).join(', ')}]`;
        case 'record':
            return `Record<${renderTsType(type.key)}, ${renderTsType(type.value)}>`;
        case 'enum':
            return type.values.map(v => `'${v}'`).join(' | ');
        case 'literal':
            return typeof type.value === 'string' ? `'${type.value}'` : String(type.value);
        case 'union':
            return type.members.map(renderTsType).join(' | ');
        case 'discriminatedUnion':
            return type.members.map(renderTsType).join(' | ');
        case 'intersection':
            return type.members.map(renderTsType).join(' & ');
        case 'ref':
            return type.name;
        case 'lazy':
            return renderTsType(type.inner);
        case 'inlineObject':
            return renderTsInlineObject(type.fields);
        default:
            return 'unknown';
    }
}

function renderTsScalar(name: string): string {
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
        case 'boolean':
            return 'boolean';
        case 'date':
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
            return 'Blob';
        case 'json':
            return 'JsonValue';
        default:
            return 'unknown';
    }
}

function renderTsInlineObject(fields: FieldNode[]): string {
    const entries = fields.map(f => {
        const opt = f.optional ? '?' : '';
        return `${quoteKey(f.name)}${opt}: ${renderTsType(f.type)}`;
    });
    return `{ ${entries.join('; ')} }`;
}

/**
 * Like renderTsType, but substitutes model refs with their Input variant
 * when the model has visibility modifiers. Used for request-side types
 * (body, params, query, headers).
 */
export function renderInputTsType(type: ContractTypeNode, modelsWithInput?: Set<string>): string {
    if (!modelsWithInput || modelsWithInput.size === 0) return renderTsType(type);
    switch (type.kind) {
        case 'ref':
            return modelsWithInput.has(type.name) ? `${type.name}Input` : type.name;
        case 'array': {
            const inner = renderInputTsType(type.item, modelsWithInput);
            const needsParens =
                type.item.kind === 'union' || type.item.kind === 'discriminatedUnion' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'intersection':
            return type.members.map(m => renderInputTsType(m, modelsWithInput)).join(' & ');
        case 'union':
            return type.members.map(m => renderInputTsType(m, modelsWithInput)).join(' | ');
        case 'discriminatedUnion':
            return type.members.map(m => renderInputTsType(m, modelsWithInput)).join(' | ');
        case 'inlineObject':
            return `{ ${type.fields.map(f => `${quoteKey(f.name)}${f.optional ? '?' : ''}: ${renderInputTsType(f.type, modelsWithInput)}`).join('; ')} }`;
        case 'lazy':
            return renderInputTsType(type.inner, modelsWithInput);
        default:
            return renderTsType(type);
    }
}

/**
 * Like renderTsType, but substitutes model refs with their Output variant
 * (post-transform wire shape) when the model has format(output=...) or
 * transitively references one. Used for response-side types in routers
 * and SDK return types.
 */
export function renderOutputTsType(type: ContractTypeNode, modelsWithOutput?: Set<string>): string {
    if (!modelsWithOutput || modelsWithOutput.size === 0) return renderTsType(type);
    switch (type.kind) {
        case 'ref':
            return modelsWithOutput.has(type.name) ? `${type.name}Output` : type.name;
        case 'array': {
            const inner = renderOutputTsType(type.item, modelsWithOutput);
            const needsParens =
                type.item.kind === 'union' || type.item.kind === 'discriminatedUnion' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'intersection':
            return type.members.map(m => renderOutputTsType(m, modelsWithOutput)).join(' & ');
        case 'union':
            return type.members.map(m => renderOutputTsType(m, modelsWithOutput)).join(' | ');
        case 'discriminatedUnion':
            return type.members.map(m => renderOutputTsType(m, modelsWithOutput)).join(' | ');
        case 'inlineObject':
            return `{ ${type.fields.map(f => `${quoteKey(f.name)}${f.optional ? '?' : ''}: ${renderOutputTsType(f.type, modelsWithOutput)}`).join('; ')} }`;
        case 'lazy':
            return renderOutputTsType(type.inner, modelsWithOutput);
        default:
            return renderTsType(type);
    }
}
