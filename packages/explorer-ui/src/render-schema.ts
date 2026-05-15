import type { ContractTypeNode, FieldNode, ScalarTypeNode } from '@contractkit/core';
import { resolveEffectiveFields } from '@contractkit/core/type-utils';
import { escapeHtml } from './html.js';
import { renderMarkdown } from './markdown.js';
import { renderType } from './render-type.js';
import type { RenderContext } from './types.js';

const STRING_SCALARS = new Set(['string', 'uuid', 'email', 'url']);

/** Per-field visibility to suppress when rendering. `readonly` for request inputs (server
 * controls those), `writeonly` for response payloads. */
export type SchemaVisibilityFilter = 'readonly' | 'writeonly';

export interface RenderSchemaOptions {
    /** Hide fields with this visibility. Pass `'readonly'` when rendering request inputs
     * (query/path/headers/request body) so server-controlled fields don't show up as inputs. */
    exclude?: SchemaVisibilityFilter;
}

/**
 * Renders a request/response body schema as an indented field tree: each row shows the field
 * name, type, required tag, description, default, and constraint chips, with nested objects/
 * arrays indented under their parent. Falls back to `renderType` for shapes that aren't
 * object-like (unions, primitives at the top level, etc.).
 */
export function renderSchemaTree(
    type: ContractTypeNode,
    ctx: RenderContext = {},
    options: RenderSchemaOptions = {},
): string {
    return renderSchemaNode(type, ctx, options);
}

function renderSchemaNode(type: ContractTypeNode, ctx: RenderContext, options: RenderSchemaOptions): string {
    if (type.kind === 'inlineObject') {
        return renderSchemaFields(type.fields, ctx, options);
    }
    if (type.kind === 'ref') {
        const entry = ctx.models?.get(type.name);
        const visited = ctx.visited ?? new Set<string>();
        if (entry && !visited.has(type.name)) {
            const next: RenderContext = {
                ...ctx,
                visited: new Set([...visited, type.name]),
                depth: (ctx.depth ?? 0) + 1,
            };
            // Use the canonical core resolver — handles inheritance, type-alias bases, nested
            // intersections, alias chains, and diamond inheritance dedup.
            const resolved = resolveEffectiveFields(type.name, modelIndexFromCtx(ctx));
            if (resolved.fields.length > 0) {
                const fieldsHtml = renderSchemaFields(resolved.fields, next, options);
                const unresolvedHtml = renderUnresolvedRefs(resolved.unresolved);
                return `${fieldsHtml}${unresolvedHtml}`;
            }
            if (resolved.unresolved.length > 0) {
                return renderUnresolvedRefs(resolved.unresolved);
            }
            // Model exists but didn't flatten to fields (e.g. alias to a union/scalar) — fall
            // through to the model's own type rendering.
            const model = entry.model;
            if (model.type) {
                return renderSchemaNode(model.type, next, options);
            }
        }
        if (!entry) {
            return renderUnresolvedRefs([type.name]);
        }
        return `<div class="ce-schema-fallback">${renderType(type, ctx)}</div>`;
    }
    if (type.kind === 'array') {
        return `<div class="ce-schema-array-label">array of:</div>${renderSchemaNode(type.item, ctx, options)}`;
    }
    if (type.kind === 'intersection') {
        const resolved = resolveEffectiveFields(type, modelIndexFromCtx(ctx));
        if (resolved.fields.length > 0 || resolved.unresolved.length > 0) {
            const fieldsHtml = resolved.fields.length > 0 ? renderSchemaFields(resolved.fields, ctx, options) : '';
            const unresolvedHtml = renderUnresolvedRefs(resolved.unresolved);
            return `${fieldsHtml}${unresolvedHtml}`;
        }
        return `<div class="ce-schema-fallback">${renderType(type, ctx)}</div>`;
    }
    if (type.kind === 'union' || type.kind === 'discriminatedUnion') {
        return renderUnion(type, ctx, options);
    }
    return `<div class="ce-schema-fallback">${renderType(type, ctx)}</div>`;
}

/** Adapter that builds a plain ModelNode index from the RenderContext's ResolvedModel map. */
function modelIndexFromCtx(ctx: RenderContext): Map<string, import('@contractkit/core').ModelNode> {
    const out = new Map<string, import('@contractkit/core').ModelNode>();
    if (ctx.models) {
        for (const [name, resolved] of ctx.models) out.set(name, resolved.model);
    }
    return out;
}


function renderUnresolvedRefs(names: string[]): string {
    if (names.length === 0) return '';
    const chips = names
        .map(n => `<a class="ce-schema-unresolved-ref ce-ref" href="#model-${encodeURIComponent(n)}">${escapeHtml(n)}</a>`)
        .join(', ');
    return `<div class="ce-schema-unresolved">
        <span class="ce-schema-unresolved-label">Unresolved</span>
        ${chips}
        <span class="ce-schema-unresolved-hint">— not loaded in the workspace.</span>
    </div>`;
}

/**
 * Renders a (discriminated) union as a stacked list of expandable variant cards. Each card
 * shows the variant model name + the discriminator literal value (when applicable), and
 * expands into that variant's full field tree.
 */
function renderUnion(
    type: Extract<ContractTypeNode, { kind: 'union' | 'discriminatedUnion' }>,
    ctx: RenderContext,
    options: RenderSchemaOptions,
): string {
    const isDiscriminated = type.kind === 'discriminatedUnion';
    const label = isDiscriminated
        ? `One of <span class="ce-schema-union-disc">by <code>${escapeHtml(type.discriminator)}</code></span>`
        : 'One of';
    const variants = type.members
        .map(m => renderVariant(m, ctx, isDiscriminated ? type.discriminator : undefined, options))
        .join('');
    return `<div class="ce-schema-union">
        <div class="ce-schema-union-label">${label}</div>
        <div class="ce-schema-union-variants">${variants}</div>
    </div>`;
}

function renderVariant(
    member: ContractTypeNode,
    ctx: RenderContext,
    discriminator: string | undefined,
    options: RenderSchemaOptions,
): string {
    const info = extractVariantInfo(member, ctx, discriminator, options);
    const discBadge = info.discriminatorValue !== undefined
        ? `<code class="ce-schema-variant-disc-value">${escapeHtml(discriminator!)}: ${escapeHtml(info.discriminatorValue)}</code>`
        : '';
    return `<details class="ce-schema-variant">
        <summary>
            <span class="ce-schema-variant-name">${info.name}</span>
            ${discBadge}
        </summary>
        <div class="ce-schema-variant-body">${info.body}</div>
    </details>`;
}

interface VariantInfo {
    name: string;
    body: string;
    discriminatorValue?: string;
}

function extractVariantInfo(
    member: ContractTypeNode,
    ctx: RenderContext,
    discriminator: string | undefined,
    options: RenderSchemaOptions,
): VariantInfo {
    if (member.kind === 'ref') {
        const entry = ctx.models?.get(member.name);
        const visited = ctx.visited ?? new Set<string>();
        if (entry && !visited.has(member.name)) {
            const next: RenderContext = {
                ...ctx,
                visited: new Set([...visited, member.name]),
                depth: (ctx.depth ?? 0) + 1,
            };
            const model = entry.model;
            const discriminatorValue = discriminator
                ? findDiscriminatorValue(model.fields, discriminator)
                : undefined;
            const resolved = resolveEffectiveFields(member.name, modelIndexFromCtx(ctx));
            let body: string;
            if (resolved.fields.length > 0 || resolved.unresolved.length > 0) {
                const fieldsHtml = resolved.fields.length > 0
                    ? renderSchemaFields(resolved.fields, next, options)
                    : '';
                body = `${fieldsHtml}${renderUnresolvedRefs(resolved.unresolved)}`;
            } else if (model.type) {
                body = renderSchemaNode(model.type, next, options);
            } else {
                body = `<p class="ce-empty">No fields.</p>`;
            }
            return { name: escapeHtml(member.name), body, discriminatorValue };
        }
        return { name: escapeHtml(member.name), body: `<div class="ce-schema-fallback">${renderType(member, ctx)}</div>` };
    }
    if (member.kind === 'inlineObject') {
        return {
            name: 'object',
            body: renderSchemaFields(member.fields, ctx, options),
            discriminatorValue: discriminator
                ? findDiscriminatorValue(member.fields, discriminator)
                : undefined,
        };
    }
    return {
        name: variantTypeName(member),
        body: `<div class="ce-schema-fallback">${renderType(member, ctx)}</div>`,
    };
}

function findDiscriminatorValue(fields: FieldNode[] | undefined, discriminator: string): string | undefined {
    if (!fields) return undefined;
    const f = fields.find(field => field.name === discriminator);
    if (!f) return undefined;
    if (f.type.kind === 'literal') {
        return typeof f.type.value === 'string' ? `"${f.type.value}"` : String(f.type.value);
    }
    if (f.type.kind === 'enum' && f.type.values.length === 1) {
        return `"${f.type.values[0]}"`;
    }
    return undefined;
}

function variantTypeName(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar': return escapeHtml(type.name);
        case 'literal': return escapeHtml(typeof type.value === 'string' ? `"${type.value}"` : String(type.value));
        case 'enum': return 'enum';
        case 'array': return 'array';
        case 'tuple': return 'tuple';
        case 'record': return 'record';
        case 'lazy': return 'lazy';
        default: return type.kind;
    }
}

function renderSchemaFields(fields: FieldNode[], ctx: RenderContext, options: RenderSchemaOptions): string {
    const visible = options.exclude ? fields.filter(f => f.visibility !== options.exclude) : fields;
    if (visible.length === 0) return '<p class="ce-empty">No fields.</p>';
    return `<div class="ce-schema-fields">${visible.map(f => renderSchemaField(f, ctx, options)).join('')}</div>`;
}

function renderSchemaField(f: FieldNode, ctx: RenderContext, options: RenderSchemaOptions): string {
    // A field with a default isn't required from the caller's perspective — the server uses the
    // default when omitted — so we suppress the REQUIRED pill in that case to avoid the visual
    // noise of every paginated query param being flagged as required.
    const required = !f.optional && f.default === undefined;
    const typeLabel = renderTypeLabel(f.type);
    const chips = renderConstraintChips(f.type);
    const enumValues = renderEnumValues(f.type, ctx);
    const desc = f.description
        ? `<div class="ce-schema-desc ce-markdown">${renderMarkdown(f.description)}</div>`
        : '';
    const defaultHtml =
        f.default !== undefined
            ? `<div class="ce-schema-default">Default: <code>${escapeHtml(String(f.default))}</code></div>`
            : '';
    const requiredTag = required ? '<span class="ce-schema-required">required</span>' : '';

    let nested = '';
    if (
        f.type.kind === 'inlineObject' ||
        f.type.kind === 'array' ||
        f.type.kind === 'ref' ||
        f.type.kind === 'intersection'
    ) {
        const inner = renderSchemaNode(f.type, ctx, options);
        if (inner.includes('ce-schema-fields') || inner.includes('ce-schema-array-label')) {
            nested = `<div class="ce-schema-nested">${inner}</div>`;
        }
    }

    return `<div class="ce-schema-row">
        <div class="ce-schema-head">
            <code class="ce-schema-name">${escapeHtml(f.name)}</code>
            ${typeLabel}
            ${requiredTag}
        </div>
        ${desc}
        ${defaultHtml}
        ${chips}
        ${enumValues}
        ${nested}
    </div>`;
}

/**
 * Returns the inline "Allowed values" list when the field's type is an enum (either inline
 * `enum(a, b, c)` or a ref to a model whose `type` alias is an enum). Empty string otherwise.
 */
function renderEnumValues(type: ContractTypeNode, ctx: RenderContext): string {
    const values = resolveEnumValues(type, ctx);
    if (!values || values.length === 0) return '';
    const chips = values
        .map(v => `<code class="ce-schema-enum-value">${escapeHtml(v)}</code>`)
        .join('');
    return `<div class="ce-schema-enum">
        <span class="ce-schema-enum-label">Allowed values:</span>
        <span class="ce-schema-enum-list">${chips}</span>
    </div>`;
}

function resolveEnumValues(type: ContractTypeNode, ctx: RenderContext): string[] | null {
    if (type.kind === 'enum') return type.values;
    if (type.kind === 'ref') {
        const entry = ctx.models?.get(type.name);
        if (entry?.model.type?.kind === 'enum') return entry.model.type.values;
    }
    return null;
}

function renderTypeLabel(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return `<span class="ce-schema-type">${escapeHtml(type.name)}</span>`;
        case 'enum':
            return `<span class="ce-schema-type">enum</span>`;
        case 'literal':
            return `<span class="ce-schema-type">literal</span>`;
        case 'ref':
            return `<a class="ce-schema-type ce-ref" href="#model-${encodeURIComponent(type.name)}">${escapeHtml(type.name)}</a>`;
        case 'array':
            return `<span class="ce-schema-type">array&lt;${innerTypeName(type.item)}&gt;</span>`;
        case 'tuple':
            return `<span class="ce-schema-type">tuple</span>`;
        case 'record':
            return `<span class="ce-schema-type">record</span>`;
        case 'union':
            return `<span class="ce-schema-type">union</span>`;
        case 'discriminatedUnion':
            return `<span class="ce-schema-type">union</span>`;
        case 'intersection': {
            const parts = type.members.map(intersectionMemberLabel);
            return `<span class="ce-schema-type">${parts.join(' &amp; ')}</span>`;
        }
        case 'lazy':
            return `<span class="ce-schema-type">lazy</span>`;
        case 'inlineObject':
            return `<span class="ce-schema-type">object</span>`;
    }
}

function innerTypeName(type: ContractTypeNode): string {
    if (type.kind === 'scalar') return escapeHtml(type.name);
    if (type.kind === 'ref') return escapeHtml(type.name);
    return type.kind;
}

function intersectionMemberLabel(type: ContractTypeNode): string {
    if (type.kind === 'ref') return escapeHtml(type.name);
    if (type.kind === 'inlineObject') return '{ … }';
    if (type.kind === 'scalar') return escapeHtml(type.name);
    return type.kind;
}

function renderConstraintChips(type: ContractTypeNode): string {
    if (type.kind !== 'scalar') return '';
    const chips = formatConstraints(type);
    if (chips.length === 0) return '';
    return `<div class="ce-schema-chips">${chips.map(c => `<span class="ce-schema-chip">${escapeHtml(c)}</span>`).join('')}</div>`;
}

function formatConstraints(s: ScalarTypeNode): string[] {
    const chips: string[] = [];
    const isString = STRING_SCALARS.has(s.name);
    const unit = isString ? ' characters' : '';
    if (s.min !== undefined) chips.push(`>= ${s.min}${unit}`);
    if (s.max !== undefined) chips.push(`<= ${s.max}${unit}`);
    if (s.len !== undefined) chips.push(`= ${s.len}${unit}`);
    if (s.format !== undefined) chips.push(`format: ${s.format}`);
    if (s.regex !== undefined) chips.push(`matches /${s.regex}/`);
    return chips;
}
