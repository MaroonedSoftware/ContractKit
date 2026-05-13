import type { FieldNode } from '@contractkit/core';
import { escapeHtml, html, raw } from './html.js';
import { renderMarkdown } from './markdown.js';
import { renderType } from './render-type.js';
import type { RenderContext, ResolvedModel } from './types.js';

/** Anchor id for a model, used by `<a href="#model-Name">` ref links. */
export function modelAnchor(name: string): string {
    return `model-${encodeURIComponent(name)}`;
}

/** Renders a model card: header, badges, inheritance line, fields (or type alias). */
export function renderModel({ filePath, model }: ResolvedModel, ctx: RenderContext = {}): string {
    const badges: string[] = [];
    if (model.deprecated) badges.push(badge('deprecated', 'deprecated'));
    if (model.mode) badges.push(badge(`mode=${model.mode}`, 'mode'));
    if (model.inputCase) badges.push(badge(`format(input=${model.inputCase})`, 'format'));
    if (model.outputCase) badges.push(badge(`format(output=${model.outputCase})`, 'format'));

    // Suppress re-expansion of the model itself when its fields contain a self-reference.
    const fieldCtx: RenderContext = {
        ...ctx,
        visited: new Set([...(ctx.visited ?? []), model.name]),
    };

    const inheritance =
        model.bases && model.bases.length > 0
            ? `<p class="ce-extends">extends ${model.bases
                  .map(b => `<a class="ce-ref" href="#model-${encodeURIComponent(b)}" data-open-model="${escapeHtml(b)}">${escapeHtml(b)}</a>`)
                  .join(', ')}</p>`
            : '';

    const description = model.description
        ? `<div class="ce-description ce-markdown">${renderMarkdown(model.description)}</div>`
        : '';

    const body = model.type
        ? `<div class="ce-type-alias">= ${renderType(model.type, fieldCtx)}</div>`
        : renderFieldRows(model.fields, fieldCtx);

    return html`<section id="${raw(modelAnchor(model.name))}" class="ce-card ce-model-card">
        <header class="ce-card-header">
            <h2>
                ${model.name}
                ${raw(badges.join(''))}
                <button
                    class="ce-jump"
                    data-jump-file="${filePath}"
                    data-jump-line="${model.loc.line}"
                    title="Open in editor"
                    type="button"
                >
                    ↗
                </button>
            </h2>
        </header>
        ${raw(inheritance)}
        ${raw(description)}
        ${raw(body)}
    </section>`;
}

/** Renders a tabular view of fields with name/type/modifiers/default/description. Exported for reuse by inline-object rendering. */
export function renderFieldRows(fields: FieldNode[], ctx: RenderContext = {}): string {
    if (fields.length === 0) return `<p class="ce-empty">No fields.</p>`;

    const rows = fields.map(f => {
        const modifiers: string[] = [];
        if (f.optional) modifiers.push('optional');
        if (f.nullable) modifiers.push('nullable');
        if (f.visibility === 'readonly') modifiers.push('readonly');
        if (f.visibility === 'writeonly') modifiers.push('writeonly');
        if (f.deprecated) modifiers.push('deprecated');
        if (f.override) modifiers.push('override');

        const modifierHtml = modifiers.map(m => badge(m, m)).join('');
        const defaultHtml =
            f.default !== undefined
                ? html`<code class="ce-default">= ${String(f.default)}</code>`
                : '';
        const descHtml = f.description ? `<div class="ce-field-desc ce-markdown">${renderMarkdown(f.description)}</div>` : '';

        return `<tr>
            <td class="ce-field-name"><code>${escapeHtml(f.name)}</code>${modifierHtml}</td>
            <td class="ce-field-type">${renderType(f.type, ctx)}${defaultHtml}${descHtml}</td>
        </tr>`;
    });

    return `<table class="ce-fields"><tbody>${rows.join('')}</tbody></table>`;
}

function badge(label: string, kind: string): string {
    return `<span class="ce-badge ce-badge-${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}
