import type { OpParamNode, ParamSource } from '@contractkit/core';
import { escapeHtml } from './html.js';
import type { ResolvedOperation } from './types.js';
import { operationAnchor } from './render-operation.js';

/**
 * Renders an interactive "Try it" form for an operation. The form collects path params, query
 * params, headers, and a JSON body, then dispatches via the host (extension or page script) on
 * submit. The host listens for `data-tryit-action="send"` clicks via event delegation.
 */
export function renderTryIt(op: ResolvedOperation, baseUrl: string): string {
    const id = operationAnchor(op);
    const pathParams = extractParams(op.routeParams);
    const queryParams = extractParams(op.op.query);
    const headerParams = extractParams(op.op.headers);
    const hasJsonBody = !!op.op.request?.bodies.some(
        b => b.contentType === 'application/json' || b.contentType.endsWith('+json'),
    );

    return `<details class="ce-tryit" data-tryit-id="${escapeHtml(id)}">
        <summary>Try it</summary>
        <form class="ce-tryit-form" onsubmit="return false;">
            <label class="ce-tryit-row">
                <span class="ce-tryit-label">Base URL</span>
                <input type="text" name="baseUrl" value="${escapeHtml(baseUrl)}" placeholder="https://api.example.com" />
            </label>
            ${renderInputSection('Path params', 'path', pathParams)}
            ${renderInputSection('Query', 'query', queryParams)}
            ${renderInputSection('Headers', 'header', headerParams)}
            ${
                hasJsonBody
                    ? `<label class="ce-tryit-row ce-tryit-col">
                        <span class="ce-tryit-label">Body (JSON)</span>
                        <textarea name="body" rows="6" placeholder="{}"></textarea>
                    </label>`
                    : ''
            }
            <div class="ce-tryit-actions">
                <button type="button" class="ce-tryit-send" data-tryit-action="send" data-tryit-target="${escapeHtml(id)}">
                    Send ${escapeHtml(op.method.toUpperCase())} ${escapeHtml(op.routePath)}
                </button>
            </div>
            <div class="ce-tryit-response" data-tryit-response="${escapeHtml(id)}"></div>
        </form>
    </details>`;
}

function extractParams(source: ParamSource | undefined): OpParamNode[] {
    if (!source || source.kind !== 'params') return [];
    return source.nodes;
}

function renderInputSection(label: string, scope: 'path' | 'query' | 'header', params: OpParamNode[]): string {
    if (params.length === 0) return '';
    const rows = params
        .map(
            p => `<label class="ce-tryit-row">
                <span class="ce-tryit-label"><code>${escapeHtml(p.name)}</code>${p.optional ? '' : ' *'}</span>
                <input type="text"
                    name="${scope}.${escapeHtml(p.name)}"
                    placeholder="${escapeHtml(typeHint(p))}"
                    ${p.default !== undefined ? `value="${escapeHtml(String(p.default))}"` : ''} />
            </label>`,
        )
        .join('');
    return `<fieldset class="ce-tryit-section"><legend>${escapeHtml(label)}</legend>${rows}</fieldset>`;
}

function typeHint(p: OpParamNode): string {
    if (p.type.kind === 'scalar') return p.type.name;
    return p.type.kind;
}
