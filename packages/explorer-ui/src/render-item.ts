import { escapeHtml, html, raw } from './html.js';
import { renderMarkdown } from './markdown.js';
import { operationAnchor, renderOperation } from './render-operation.js';
import { modelAnchor, renderModel } from './render-model.js';
import type { PreviewData, PreviewServer, RenderContext, ResolvedModel, ResolvedOperation } from './types.js';

/** Discriminated union identifying which item the detail page should render. */
export type ItemSelection =
    | { kind: 'operation'; id: string }
    | { kind: 'model'; name: string }
    | { kind: 'overview' }
    | { kind: 'file'; path: string };

/** Options for {@link renderItemPage}. */
export interface RenderItemOptions {
    /** Base URL surfaced to the operation's Try-it form. Pass an empty string to render the form with no default; omit to hide the form. */
    tryItBaseUrl?: string;
}

/**
 * Renders a single-item detail page intended for a focused webview. Wraps `renderOperation` /
 * `renderModel` / a file page (all operations + models declared in one source file) / an
 * Overview block in a minimal shell — no sidebar (the consumer provides navigation via a
 * native tree view).
 *
 * The Overview block now includes a collapsible "Endpoints by area" list grouping operations
 * by their `fileGroup` — each row links to the operation's detail panel via a
 * `data-open-operation="<anchor>"` attribute that webview consumers handle as an
 * `openOperation` message.
 */
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

    if (selection.kind === 'file') {
        return renderFilePage(data, selection.path, options, ctx);
    }

    const model = data.models.find(m => m.model.name === selection.name);
    if (!model) {
        return renderMissing(
            `Model \`${selection.name}\` isn't defined in any indexed \`.ck\` file. ` +
            `It's referenced from another contract but not declared anywhere in the workspace — ` +
            `check that the file containing \`contract ${selection.name}: { ... }\` (or its type alias) ` +
            `is present and saved. ${data.models.length} model${data.models.length === 1 ? '' : 's'} loaded.`,
        );
    }
    return renderModel(model, ctx);
}

/**
 * Renders every operation and model declared in a single source file. Used by the live-preview
 * panel that follows the active editor — operations stack first, then models.
 */
function renderFilePage(
    data: PreviewData,
    path: string,
    options: RenderItemOptions,
    ctx: RenderContext,
): string {
    const ops = data.operations.filter(o => o.filePath === path);
    const models = data.models.filter(m => m.filePath === path);
    if (ops.length === 0 && models.length === 0) {
        return renderMissing(`No contracts or operations found in \`${path}\`.`);
    }
    const opsHtml = ops.map(o => renderOperation(o, { tryItBaseUrl: options.tryItBaseUrl, ctx })).join('');
    const modelsHtml = models.map(m => renderModel(m, ctx)).join('');
    const fileLabel = path.split('/').pop() ?? path;
    return html`<section class="ce-section">
        <h1>${fileLabel}</h1>
        <p class="ce-version"><code>${path}</code></p>
        ${raw(ops.length > 0 ? `<section class="ce-section"><h1 id="endpoints">Endpoints</h1>${opsHtml}</section>` : '')}
        ${raw(models.length > 0 ? `<section class="ce-section"><h1 id="models">Models</h1>${modelsHtml}</section>` : '')}
    </section>`;
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
    const endpoints = renderEndpointsByArea(data);

    return html`<section id="overview" class="ce-section ce-overview">
        <h1>${configMeta.title}</h1>
        <p class="ce-version">v${configMeta.version}</p>
        ${raw(description)}
        ${raw(stats)}
        ${raw(endpoints)}
        ${raw(servers)}
        <p class="ce-hint">Pick an endpoint or model from the API Explorer in the sidebar to see details.</p>
    </section>`;
}

function renderEndpointsByArea(data: PreviewData): string {
    if (data.operations.length === 0) return '';

    const byArea = new Map<string, ResolvedOperation[]>();
    for (const op of data.operations) {
        const key = op.fileGroup;
        const list = byArea.get(key);
        if (list) list.push(op);
        else byArea.set(key, [op]);
    }

    const sortedAreas = [...byArea.keys()].sort((a, b) => a.localeCompare(b));
    const openByDefault = sortedAreas.length <= 3;

    const sections = sortedAreas
        .map(area => {
            const ops = byArea.get(area)!;
            const rows = ops
                .map(op => {
                    const name = op.op.name?.trim();
                    const nameHtml = name
                        ? `<span class="ce-overview-endpoint-name">${escapeHtml(name)}</span>`
                        : '';
                    return (
                        `<li><a class="ce-overview-endpoint" href="#${escapeHtml(operationAnchor(op))}" data-open-operation="${escapeHtml(operationAnchor(op))}">` +
                        `<span class="ce-method ce-method-${escapeHtml(op.method)}">${escapeHtml(op.method.toUpperCase())}</span>` +
                        `<code class="ce-overview-endpoint-path">${escapeHtml(op.routePath)}</code>` +
                        nameHtml +
                        `</a></li>`
                    );
                })
                .join('');
            return (
                `<details class="ce-overview-area"${openByDefault ? ' open' : ''}>` +
                `<summary>` +
                `<span class="ce-overview-area-name">${escapeHtml(area)}</span>` +
                `<span class="ce-overview-area-count">${ops.length}</span>` +
                `</summary>` +
                `<ul class="ce-overview-endpoints">${rows}</ul>` +
                `</details>`
            );
        })
        .join('');

    return `<section class="ce-subsection ce-overview-endpoints-section"><h3>Endpoints by area</h3>${sections}</section>`;
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
