import type {
    OpParamNode,
    OpRequestBodyNode,
    OpResponseHeaderNode,
    OpResponseNode,
    ParamSource,
    SecurityNode,
} from '@contractkit/core';
import { escapeHtml, html, raw } from './html.js';
import { renderMarkdown } from './markdown.js';
import { renderCodeSamples } from './render-code-samples.js';
import { renderSchemaTree } from './render-schema.js';
import { renderTryIt } from './render-tryit.js';
import { renderType } from './render-type.js';
import type { RenderContext, ResolvedOperation } from './types.js';

/** Anchor id for an operation. Stable across renders so the sidebar can deep-link to it. */
export function operationAnchor(op: ResolvedOperation): string {
    const suffix = op.op.sdk ?? op.op.name ?? '';
    const slug = `${op.method}-${op.routePath}-${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `op-${slug}`;
}

/** Options for {@link renderOperation}. */
export interface RenderOperationOptions {
    /** Base URL pre-filled into the Try-it form. Empty string when no base is configured. Omit to hide the Try-it form. */
    tryItBaseUrl?: string;
    /** Render context used to inline `ref` types as collapsible model expansions. */
    ctx?: RenderContext;
    /** When true, the card renders as a `<details>` element whose `<summary>` is the header row, so consumers can collapse it. Open by default. */
    collapsible?: boolean;
}

/**
 * Renders an operation card with header (method, path, badges, jump-to-source), description,
 * service/signature lines, parameter tables (path/query/headers), request body, responses,
 * plugin extensions, and an optional Try-it form when `options.tryItBaseUrl` is defined.
 *
 * When `options.collapsible` is true, the card is emitted as a `<details>` element with the
 * header row as its `<summary>` so callers (e.g. the file detail page that stacks multiple
 * operations) can let users fold individual routes. The element opens by default.
 */
export function renderOperation(op: ResolvedOperation, options: RenderOperationOptions = {}): string {
    const ctx = options.ctx ?? {};
    const badges: string[] = [];
    for (const m of op.effectiveModifiers) {
        badges.push(badge(m, m));
    }
    const securityBadge = renderSecurityBadge(op.effectiveSecurity);
    if (securityBadge) badges.push(securityBadge);

    const description = op.op.description
        ? `<div class="ce-description ce-markdown">${renderMarkdown(op.op.description)}</div>`
        : '';
    const service = op.op.service ? html`<p class="ce-meta"><strong>service:</strong> <code>${op.op.service}</code></p>` : '';
    const signature = op.op.signature
        ? html`<p class="ce-meta"><strong>signature:</strong> <code>${op.op.signature}</code>${
              op.op.signaturePolicy ? html` <code>policy: ${op.op.signaturePolicy}</code>` : ''
          }${op.op.signatureDescription ? raw(` — ${escapeHtml(op.op.signatureDescription)}`) : ''}</p>`
        : '';

    const pathParams = renderParamSection('Path Parameters', op.routeParams, ctx);
    const queryParams = renderParamSection('Query Parameters', op.op.query, ctx);
    const headerParams = renderParamSection('Request Headers', op.op.headers, ctx);
    const requestBody = renderRequest(op.op.request, ctx);
    const responses = renderResponses(op.op.responses, ctx);
    const pluginExt = renderPluginExtensions(op.op.pluginExtensions);
    const tryIt = options.tryItBaseUrl !== undefined ? renderTryIt(op, options.tryItBaseUrl, ctx) : '';
    const codeSamples = renderCodeSamples(op, options.tryItBaseUrl ?? '', ctx);

    const title = op.op.name ?? op.op.sdk ?? `${op.method.toUpperCase()} ${op.routePath}`;

    const headerInner = html`<div class="ce-op-title-row">
            <h1 class="ce-op-title">${title}</h1>
            <button
                class="ce-jump"
                data-jump-file="${op.filePath}"
                data-jump-line="${op.op.loc.line}"
                title="Open in editor"
                type="button"
            >
                ↗
            </button>
        </div>
        <div class="ce-endpoint-row">
            <span class="ce-method ce-method-${raw(op.method)}">${op.method.toUpperCase()}</span>
            <code class="ce-path">${op.routePath}</code>
            ${raw(badges.length > 0 ? `<span class="ce-badge-row">${badges.join('')}</span>` : '')}
        </div>`;

    const bodyInner = html`<div class="ce-op-main">
            ${raw(description)}
            ${raw(service)}
            ${raw(signature)}
            ${raw(pathParams)}
            ${raw(queryParams)}
            ${raw(headerParams)}
            ${raw(requestBody)}
            ${raw(responses)}
            ${raw(pluginExt)}
        </div>
        <div class="ce-op-resize" data-resize-handle role="separator" aria-orientation="vertical" aria-label="Resize columns" tabindex="0"></div>
        <aside class="ce-op-rail">
            ${raw(tryIt)}
            ${raw(codeSamples)}
        </aside>`;

    if (options.collapsible) {
        return html`<details id="${raw(operationAnchor(op))}" class="ce-card ce-op-card ce-op-card-collapsible" open>
            <summary class="ce-card-header">${raw(headerInner)}</summary>
            <div class="ce-op-body">${raw(bodyInner)}</div>
        </details>`;
    }

    return html`<section id="${raw(operationAnchor(op))}" class="ce-card ce-op-card">
        <header class="ce-card-header">${raw(headerInner)}</header>
        <div class="ce-op-body">${raw(bodyInner)}</div>
    </section>`;
}

function renderSecurityBadge(security: SecurityNode | undefined): string {
    if (security === undefined) return badge('security: secured', 'security-secured');
    if (security === 'none') return badge('security: none', 'security-none');
    if (security.policy === false) return badge('security: no policy', 'security-no-policy');
    if (typeof security.policy === 'string') return badge(`policy: ${security.policy}`, 'security-policy');
    return '';
}

function renderParamSection(label: string, source: ParamSource | undefined, ctx: RenderContext): string {
    if (!source) return '';
    if (source.kind === 'params') {
        if (source.nodes.length === 0) return '';
        return html`<section class="ce-subsection">
            <h3>${label}</h3>
            ${raw(renderParamTable(source.nodes, ctx))}
        </section>`;
    }
    if (source.kind === 'ref') {
        return html`<section class="ce-subsection">
            <h3>${label}</h3>
            ${raw(renderSchemaTree({ kind: 'ref', name: source.name }, ctx, { exclude: 'readonly' }))}
        </section>`;
    }
    return html`<section class="ce-subsection">
        <h3>${label}</h3>
        ${raw(renderSchemaTree(source.node, ctx, { exclude: 'readonly' }))}
    </section>`;
}

function renderParamTable(params: OpParamNode[], ctx: RenderContext): string {
    const rows = params.map(p => {
        const modifiers: string[] = [];
        if (p.optional) modifiers.push('optional');
        if (p.nullable) modifiers.push('nullable');
        const modifierHtml = modifiers.map(m => badge(m, m)).join('');
        const defaultHtml = p.default !== undefined ? html`<code class="ce-default">= ${String(p.default)}</code>` : '';
        const descHtml = p.description ? `<div class="ce-field-desc ce-markdown">${renderMarkdown(p.description)}</div>` : '';
        return `<tr>
            <td class="ce-field-name"><code>${escapeHtml(p.name)}</code>${modifierHtml}</td>
            <td class="ce-field-type">${renderType(p.type, ctx)}${defaultHtml}${descHtml}</td>
        </tr>`;
    });
    return `<table class="ce-fields"><tbody>${rows.join('')}</tbody></table>`;
}

function renderRequest(request: { bodies: OpRequestBodyNode[] } | undefined, ctx: RenderContext): string {
    if (!request || request.bodies.length === 0) return '';
    const blocks = request.bodies.map(body => {
        return `<div class="ce-body-block">
            <div class="ce-body-header">
                <span class="ce-body-title">Body</span>
                <span class="ce-content-type"><code>${escapeHtml(body.contentType)}</code></span>
            </div>
            ${renderSchemaTree(body.bodyType, ctx, { exclude: 'readonly' })}
        </div>`;
    });
    return `<section class="ce-subsection"><h3>Request</h3>${blocks.join('')}</section>`;
}

function renderResponses(responses: OpResponseNode[], ctx: RenderContext): string {
    if (responses.length === 0) return '';
    // Only show the at-a-glance status pill row when there's more than one response — for a
    // single response the row would just duplicate the response block header right below it.
    const summary = responses.length > 1
        ? responses
              .map(r => {
                  const statusClass = `ce-status-${Math.floor(r.statusCode / 100)}xx`;
                  return `<a class="ce-status ${statusClass}" href="#response-${r.statusCode}">${r.statusCode}</a>`;
              })
              .join('')
        : '';
    const blocks = responses.map(r => renderResponse(r, ctx));
    return `<section class="ce-subsection">
        <h3>Responses</h3>
        ${summary ? `<div class="ce-status-summary">${summary}</div>` : ''}
        ${blocks.join('')}
    </section>`;
}

function renderResponse(response: OpResponseNode, ctx: RenderContext): string {
    const statusClass = `ce-status-${Math.floor(response.statusCode / 100)}xx`;
    const contentTypeHtml = response.contentType
        ? `<span class="ce-content-type"><code>${escapeHtml(response.contentType)}</code></span>`
        : '';
    const bodyHtml = response.bodyType
        ? renderSchemaTree(response.bodyType, ctx, { exclude: 'writeonly' })
        : '<p class="ce-empty">No response body.</p>';
    const headersHtml = renderResponseHeaders(response.headers, ctx);
    return `<div class="ce-response-block" id="response-${response.statusCode}">
        <div class="ce-body-header">
            <span class="ce-status ${statusClass}">${response.statusCode}</span>
            ${contentTypeHtml}
        </div>
        ${bodyHtml}
        ${headersHtml}
    </div>`;
}

function renderResponseHeaders(headers: OpResponseHeaderNode[] | undefined, ctx: RenderContext): string {
    if (!headers || headers.length === 0) return '';
    const rows = headers.map(h => {
        const optional = h.optional ? badge('optional', 'optional') : '';
        const desc = h.description ? `<div class="ce-field-desc ce-markdown">${renderMarkdown(h.description)}</div>` : '';
        return `<tr>
            <td class="ce-field-name"><code>${escapeHtml(h.name)}</code>${optional}</td>
            <td class="ce-field-type">${renderType(h.type, ctx)}${desc}</td>
        </tr>`;
    });
    return `<h5>Headers</h5><table class="ce-fields"><tbody>${rows.join('')}</tbody></table>`;
}

function renderPluginExtensions(ext: Record<string, unknown> | undefined): string {
    if (!ext || Object.keys(ext).length === 0) return '';
    const json = JSON.stringify(ext, null, 2);
    return html`<section class="ce-subsection">
        <h3>Plugin extensions</h3>
        <details><summary>Show JSON</summary><pre class="ce-code">${json}</pre></details>
    </section>`;
}

function badge(label: string, kind: string): string {
    return `<span class="ce-badge ce-badge-${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}
