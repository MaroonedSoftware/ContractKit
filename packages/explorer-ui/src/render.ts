import { escapeHtml, html, raw } from './html.js';
import { operationAnchor, renderOperation } from './render-operation.js';
import { modelAnchor, renderModel } from './render-model.js';
import type { PreviewData, ResolvedOperation } from './types.js';

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'] as const;

const SIDEBAR_MARKER_SVG =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">' +
    '<circle cx="8" cy="8" r="6.25" />' +
    '<circle cx="8" cy="8" r="3.25" />' +
    '<circle cx="8" cy="8" r="0.75" fill="currentColor" />' +
    '</svg>';

/**
 * Renders the complete API explorer as an HTML fragment. Drop the result into a container
 * element (e.g. `root.innerHTML = renderApp(data)`) and pair with the package's `style.css`.
 */
export function renderApp(data: PreviewData): string {
    const warnings = renderWarnings(data.warnings);
    const overview = renderOverview(data);
    const sidebar = renderSidebar(data);
    const operations = sortOperations(data.operations);
    const opsHtml = operations.map(op => renderOperation(op)).join('');
    const modelsHtml = [...data.models]
        .sort((a, b) => a.model.name.localeCompare(b.model.name))
        .map(m => renderModel(m))
        .join('');

    return html`<div class="ce-layout">
        ${raw(sidebar)}
        <main class="ce-detail">
            ${raw(warnings)}
            ${raw(overview)}
            ${operations.length > 0 ? raw(`<section class="ce-section"><h1 id="endpoints">Endpoints</h1>${opsHtml}</section>`) : ''}
            ${data.models.length > 0 ? raw(`<section class="ce-section"><h1 id="models">Models</h1>${modelsHtml}</section>`) : ''}
        </main>
    </div>`;
}

function renderOverview(data: PreviewData): string {
    const { configMeta } = data;
    const description = configMeta.description
        ? html`<p class="ce-description">${configMeta.description}</p>`
        : '';
    const servers =
        configMeta.servers && configMeta.servers.length > 0
            ? `<section class="ce-subsection"><h3>Servers</h3><ul>${configMeta.servers
                  .map(s => `<li><code>${escapeHtml(s.url)}</code>${s.description ? ` — ${escapeHtml(s.description)}` : ''}</li>`)
                  .join('')}</ul></section>`
            : '';
    return html`<section id="overview" class="ce-section ce-overview">
        <h1>${configMeta.title}</h1>
        <p class="ce-version">v${configMeta.version}</p>
        ${raw(description)}
        ${raw(servers)}
    </section>`;
}

function renderSidebar(data: PreviewData): string {
    const operations = sortOperations(data.operations);
    const groups = groupBy(operations, op => op.fileGroup);
    const groupKeys = [...groups.keys()].sort();

    const endpointGroups = groupKeys
        .map(key => {
            const items = groups
                .get(key)!
                .map(op => {
                    const name = op.op.name ?? op.op.sdk ?? op.routePath;
                    return `<li><a class="ce-sidebar-row" href="#${escapeHtml(operationAnchor(op))}">
                        <span class="ce-sidebar-marker" aria-hidden="true">${SIDEBAR_MARKER_SVG}</span>
                        <span class="ce-sidebar-name">${escapeHtml(name)}</span>
                        <span class="ce-sidebar-method ce-method-text-${escapeHtml(op.method)}">${escapeHtml(op.method.toUpperCase())}</span>
                    </a></li>`;
                })
                .join('');
            return `<details open class="ce-sidebar-group">
                <summary>${escapeHtml(key)}</summary>
                <ul>${items}</ul>
            </details>`;
        })
        .join('');

    const modelLinks = [...data.models]
        .sort((a, b) => a.model.name.localeCompare(b.model.name))
        .map(m => `<li><a href="#${escapeHtml(modelAnchor(m.model.name))}">${escapeHtml(m.model.name)}</a></li>`)
        .join('');

    return `<aside class="ce-sidebar">
        <nav>
            <section>
                <h4><a href="#overview">Overview</a></h4>
            </section>
            ${operations.length > 0 ? `<section><h4><a href="#endpoints">Endpoints</a></h4>${endpointGroups}</section>` : ''}
            ${data.models.length > 0 ? `<section><h4><a href="#models">Models</a></h4><ul class="ce-model-list">${modelLinks}</ul></section>` : ''}
        </nav>
    </aside>`;
}

function renderWarnings(warnings: PreviewData['warnings']): string {
    if (warnings.length === 0) return '';
    const items = warnings
        .map(w => `<li>${escapeHtml(w.message)}${w.file ? ` <code>${escapeHtml(w.file)}${w.line ? `:${w.line}` : ''}</code>` : ''}</li>`)
        .join('');
    return `<div class="ce-warnings"><strong>${warnings.length} warning${warnings.length === 1 ? '' : 's'}</strong><ul>${items}</ul></div>`;
}

function sortOperations(operations: ResolvedOperation[]): ResolvedOperation[] {
    return [...operations].sort((a, b) => {
        const groupCmp = a.fileGroup.localeCompare(b.fileGroup);
        if (groupCmp !== 0) return groupCmp;
        const pathCmp = a.routePath.localeCompare(b.routePath);
        if (pathCmp !== 0) return pathCmp;
        return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
    });
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const item of items) {
        const key = keyFn(item);
        const arr = out.get(key);
        if (arr) arr.push(item);
        else out.set(key, [item]);
    }
    return out;
}
