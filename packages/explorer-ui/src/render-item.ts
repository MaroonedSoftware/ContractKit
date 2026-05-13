import { escapeHtml, html, raw } from './html.js';
import { renderMarkdown } from './markdown.js';
import { operationAnchor, renderOperation } from './render-operation.js';
import { modelAnchor, renderModel } from './render-model.js';
import type { PreviewData, PreviewServer, RenderContext, ResolvedModel, ResolvedOperation } from './types.js';

/** Discriminated union identifying which item the detail page should render. */
export type ItemSelection =
    | { kind: 'operation'; id: string }
    | { kind: 'model'; name: string }
    | { kind: 'overview' };

/**
 * Renders a single-item detail page intended for a focused webview. Wraps `renderOperation` /
 * `renderModel` / an Overview block in a minimal shell — no sidebar (the consumer provides
 * navigation via a native tree view).
 */
/** Options for {@link renderItemPage}. */
export interface RenderItemOptions {
    /** Base URL surfaced to the operation's Try-it form. Pass an empty string to render the form with no default; omit to hide the form. */
    tryItBaseUrl?: string;
}

export function renderItemPage(data: PreviewData, selection: ItemSelection, options: RenderItemOptions = {}): string {
    const body = renderBody(data, selection, options);
    return html`<div class="ce-detail ce-detail-single">${raw(body)}</div>`;
}

function renderBody(data: PreviewData, selection: ItemSelection, options: RenderItemOptions): string {
    if (selection.kind === 'overview') return renderOverviewPage(data);

    const ctx: RenderContext = { models: buildModelMap(data) };

    if (selection.kind === 'operation') {
        const op = data.operations.find(o => operationAnchor(o) === selection.id);
        if (!op) return renderMissing(`Operation \`${selection.id}\` is not in the current workspace.`);
        return renderOperation(op, { tryItBaseUrl: options.tryItBaseUrl, ctx });
    }

    const model = data.models.find(m => m.model.name === selection.name);
    if (!model) return renderMissing(`Model \`${selection.name}\` is not in the current workspace.`);
    return renderModel(model, ctx);
}

function buildModelMap(data: PreviewData): Map<string, ResolvedModel> {
    const out = new Map<string, ResolvedModel>();
    for (const entry of data.models) out.set(entry.model.name, entry);
    return out;
}

function renderOverviewPage(data: PreviewData): string {
    const { configMeta } = data;
    const description = configMeta.description
        ? `<div class="ce-description ce-markdown">${renderMarkdown(configMeta.description)}</div>`
        : '';
    const servers = renderServersList(configMeta.servers);
    const stats = `<dl class="ce-stats">
        <dt>Endpoints</dt><dd>${data.operations.length}</dd>
        <dt>Models</dt><dd>${data.models.length}</dd>
    </dl>`;

    return html`<section id="overview" class="ce-section ce-overview">
        <h1>${configMeta.title}</h1>
        <p class="ce-version">v${configMeta.version}</p>
        ${raw(description)}
        ${raw(stats)}
        ${raw(servers)}
        <p class="ce-hint">Pick an endpoint or model from the API Explorer in the sidebar to see details.</p>
    </section>`;
}

function renderServersList(servers: PreviewServer[] | undefined): string {
    if (!servers || servers.length === 0) return '';
    const items = servers
        .map(
            s =>
                `<li><code>${escapeHtml(s.url)}</code>${
                    s.description ? ` — ${escapeHtml(s.description)}` : ''
                }</li>`,
        )
        .join('');
    return `<section class="ce-subsection"><h3>Servers</h3><ul>${items}</ul></section>`;
}

function renderMissing(message: string): string {
    return `<section class="ce-card ce-missing"><p class="ce-empty">${escapeHtml(message)}</p></section>`;
}

/** Stable ids used by tree-view consumers to refer to operations and models. */
export const operationId = operationAnchor;
export const modelId = (name: string): string => modelAnchor(name);

/**
 * Returns every selectable item in `data` as a flat list with its stable id paired with the
 * full resolved entry. Useful for building a navigation tree or a flat picker.
 */
export function listSelections(data: PreviewData): Array<
    | { kind: 'operation'; id: string; operation: ResolvedOperation }
    | { kind: 'model'; name: string; model: ResolvedModel }
> {
    return [
        ...data.operations.map(operation => ({ kind: 'operation' as const, id: operationId(operation), operation })),
        ...data.models.map(model => ({ kind: 'model' as const, name: model.model.name, model })),
    ];
}
