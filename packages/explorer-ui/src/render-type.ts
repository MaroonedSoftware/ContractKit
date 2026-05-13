import type { ContractTypeNode } from '@contractkit/core';
import { escapeHtml } from './html.js';
import { constraintSummary } from './constraints.js';
import { renderFieldRows } from './render-model.js';
import type { RenderContext } from './types.js';

const DEFAULT_MAX_DEPTH = 4;

/**
 * Recursively renders a ContractTypeNode as inline HTML.
 *
 * When `ctx.models` is provided, `ref` types render as collapsible `<details>` containing the
 * referenced model's fields. `ctx.visited` (set internally) prevents infinite recursion on
 * self-referential models. Past `ctx.maxDepth` (default 4) refs collapse to plain links.
 */
export function renderType(type: ContractTypeNode, ctx: RenderContext = {}): string {
    switch (type.kind) {
        case 'scalar': {
            const constraint = constraintSummary(type);
            const constraintHtml = constraint
                ? `<span class="ce-type-constraint">${escapeHtml(constraint)}</span>`
                : '';
            return `<span class="ce-type-scalar">${escapeHtml(type.name)}${constraintHtml}</span>`;
        }
        case 'enum':
            return `<span class="ce-type-enum">enum(${type.values.map(escapeHtml).join(', ')})</span>`;
        case 'literal':
            return `<span class="ce-type-literal">${escapeHtml(
                typeof type.value === 'string' ? `"${type.value}"` : String(type.value),
            )}</span>`;
        case 'ref':
            return renderRef(type.name, ctx);
        case 'array':
            return `${tok('Array&lt;')}${renderType(type.item, ctx)}${tok('&gt;')}`;
        case 'tuple':
            return `${tok('[')}${type.items.map(t => renderType(t, ctx)).join(tok(', '))}${tok(']')}`;
        case 'record':
            return `${tok('Record&lt;')}${renderType(type.key, ctx)}${tok(', ')}${renderType(type.value, ctx)}${tok('&gt;')}`;
        case 'union':
            return type.members.map(m => renderType(m, ctx)).join(tok(' | '));
        case 'discriminatedUnion':
            return (
                `${tok(`Union by ${escapeHtml(type.discriminator)}:`)} ` +
                type.members.map(m => renderType(m, ctx)).join(tok(' | '))
            );
        case 'intersection':
            return type.members.map(m => renderType(m, ctx)).join(tok(' &amp; '));
        case 'lazy':
            return `${tok('Lazy&lt;')}${renderType(type.inner, ctx)}${tok('&gt;')}`;
        case 'inlineObject':
            return `<details class="ce-inline-object"><summary>${tok('{ … }')}</summary>${renderFieldRows(type.fields, ctx)}</details>`;
    }
}

function renderRef(name: string, ctx: RenderContext): string {
    const encName = encodeURIComponent(name);
    const safeName = escapeHtml(name);
    const entry = ctx.models?.get(name);
    const visited = ctx.visited ?? new Set<string>();
    const depth = ctx.depth ?? 0;
    const maxDepth = ctx.maxDepth ?? DEFAULT_MAX_DEPTH;

    if (!entry) {
        // Unknown model — render as a link that lets the host navigate to the dedicated page.
        return `<a class="ce-ref" href="#model-${encName}">${safeName}</a>`;
    }
    if (visited.has(name)) {
        return `<span class="ce-ref ce-ref-cycle" title="recursive reference">${safeName} ↺</span>`;
    }

    const model = entry.model;
    const jumpAttrs = `data-jump-file="${escapeHtml(entry.filePath)}" data-jump-line="${model.loc.line}"`;

    if (depth >= maxDepth) {
        return `<a class="ce-ref" href="#model-${encName}" ${jumpAttrs} title="Jump to source">${safeName}</a>`;
    }

    const nextCtx: RenderContext = {
        models: ctx.models,
        visited: new Set([...visited, name]),
        maxDepth,
        depth: depth + 1,
    };

    const bases =
        model.bases && model.bases.length > 0
            ? `<p class="ce-extends">extends ${model.bases
                  .map(b => renderRef(b, nextCtx))
                  .join(', ')}</p>`
            : '';

    const body = model.type
        ? `<div class="ce-type-alias">= ${renderType(model.type, nextCtx)}</div>`
        : renderFieldRows(model.fields, nextCtx);

    const openButton = `<button class="ce-ref-open" type="button" ${jumpAttrs} title="Jump to source">↗</button>`;

    return `<details class="ce-ref-expand">
        <summary><span class="ce-ref-name">${safeName}</span>${openButton}</summary>
        <div class="ce-ref-body">${bases}${body}</div>
    </details>`;
}

/** Internal: render a structural separator/keyword. Caller is responsible for escaping `text`. */
function tok(text: string): string {
    return `<span class="ce-type-token">${text}</span>`;
}
