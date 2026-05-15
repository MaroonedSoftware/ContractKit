import type { OpParamNode, ParamSource } from '@contractkit/core';
import { escapeHtml } from './html.js';
import { buildSampleJson } from './render-code-samples.js';
import type { RenderContext, ResolvedOperation } from './types.js';
import { operationAnchor } from './render-operation.js';

/**
 * Renders an interactive "Try it" form for an operation. The form collects path params, query
 * params, headers, and a JSON body, then dispatches via the host (extension or page script) on
 * submit. The host listens for `data-tryit-action="send"` clicks via event delegation.
 *
 * Inputs are pre-filled with realistic faker-generated samples derived from the schema so the
 * user can hit Send immediately instead of hand-crafting a payload. Pre-fills are
 * deterministic (seeded by operation identity) so re-renders don't flicker the values.
 */
export function renderTryIt(op: ResolvedOperation, baseUrl: string, ctx: RenderContext = {}): string {
    const id = operationAnchor(op);
    const pathParams = extractParams(op.routeParams);
    const queryParams = extractParams(op.op.query);
    const headerParams = extractParams(op.op.headers);
    const jsonBody = op.op.request?.bodies.find(
        b => b.contentType === 'application/json' || b.contentType.endsWith('+json'),
    );
    const bodySeed = `${op.method}:${op.routePath}:request-body`;
    const bodyPrefill = jsonBody
        ? JSON.stringify(buildSampleJson(jsonBody.bodyType, ctx, bodySeed, 'readonly'), null, 2)
        : '';

    return `<details class="ce-tryit" data-tryit-id="${escapeHtml(id)}">
        <summary>Try it</summary>
        <form class="ce-tryit-form" onsubmit="return false;">
            <label class="ce-tryit-row">
                <span class="ce-tryit-label">Base URL</span>
                <input type="text" name="baseUrl" value="${escapeHtml(baseUrl)}" placeholder="https://api.example.com" />
            </label>
            ${renderInputSection('Path params', 'path', pathParams, ctx, op)}
            ${renderInputSection('Query', 'query', queryParams, ctx, op)}
            ${renderInputSection('Headers', 'header', headerParams, ctx, op)}
            ${
                jsonBody
                    ? `<label class="ce-tryit-row ce-tryit-col">
                        <span class="ce-tryit-label">Body (JSON)</span>
                        <textarea name="body" rows="8" placeholder="{}">${escapeHtml(bodyPrefill)}</textarea>
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

function renderInputSection(
    label: string,
    scope: 'path' | 'query' | 'header',
    params: OpParamNode[],
    ctx: RenderContext,
    op: ResolvedOperation,
): string {
    if (params.length === 0) return '';
    const rows = params
        .map(p => {
            const prefill = paramPrefill(p, ctx, op, scope);
            return `<label class="ce-tryit-row">
                <span class="ce-tryit-label"><code>${escapeHtml(p.name)}</code>${p.optional ? '' : ' *'}</span>
                <input type="text"
                    name="${scope}.${escapeHtml(p.name)}"
                    placeholder="${escapeHtml(typeHint(p))}"
                    value="${escapeHtml(prefill)}" />
            </label>`;
        })
        .join('');
    return `<fieldset class="ce-tryit-section"><legend>${escapeHtml(label)}</legend>${rows}</fieldset>`;
}

function paramPrefill(
    p: OpParamNode,
    ctx: RenderContext,
    op: ResolvedOperation,
    scope: 'path' | 'query' | 'header',
): string {
    // Explicit defaults always win.
    if (p.default !== undefined) return String(p.default);
    // Generate a realistic value from the schema. Stringify primitives directly; for objects
    // (rare for params) fall back to a JSON dump.
    const seed = `${op.method}:${op.routePath}:${scope}:${p.name}`;
    const sample = buildSampleJson(p.type, ctx, seed, 'readonly');
    if (sample === null || sample === undefined) return '';
    if (typeof sample === 'object') return JSON.stringify(sample);
    return String(sample);
}

function typeHint(p: OpParamNode): string {
    if (p.type.kind === 'scalar') return p.type.name;
    return p.type.kind;
}
