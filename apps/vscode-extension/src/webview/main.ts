import { renderItemPage, type ItemSelection, type PreviewData } from '@contractkit/explorer-ui';

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface RenderMessage {
    type: 'render';
    data: PreviewData;
    selection: ItemSelection;
    tryItBaseUrl?: string;
}

interface TryResponseMessage {
    type: 'tryResponse';
    response: {
        operationId: string;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
        bytes: number;
        isText: boolean;
        elapsedMs: number;
        error?: string;
    };
}

type IncomingMessage = RenderMessage | TryResponseMessage;

const vscode = acquireVsCodeApi();
const root = document.getElementById('root');

window.addEventListener('error', e => {
    if (root) {
        root.innerHTML = `<pre style="padding:16px;color:#cf222e;white-space:pre-wrap;">Preview error: ${esc(e.message)}\n${esc((e.error?.stack as string) ?? '')}</pre>`;
    }
});

interface PersistedState {
    data?: PreviewData;
    selection?: ItemSelection;
    tryItBaseUrl?: string;
}

if (root) {
    root.innerHTML = '<p style="padding:24px;opacity:0.6;">Loading…</p>';

    const previous = (vscode.getState() as PersistedState | undefined) ?? {};
    if (previous.data && previous.selection) {
        render(previous.data, previous.selection, previous.tryItBaseUrl ?? '');
    }

    window.addEventListener('message', event => {
        const msg = event.data as IncomingMessage | undefined;
        if (!msg) return;
        if (msg.type === 'render' && msg.data && msg.selection) {
            const baseUrl = msg.tryItBaseUrl ?? '';
            vscode.setState({ data: msg.data, selection: msg.selection, tryItBaseUrl: baseUrl });
            render(msg.data, msg.selection, baseUrl);
            return;
        }
        if (msg.type === 'tryResponse') {
            renderTryResponse(msg.response);
            return;
        }
    });

    root.addEventListener('click', event => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const sendBtn = target.closest('[data-tryit-action="send"]') as HTMLButtonElement | null;
        if (sendBtn) {
            event.preventDefault();
            const opId = sendBtn.dataset.tryitTarget ?? '';
            sendTryIt(opId, sendBtn);
            return;
        }

        // Explicit "open full page" button on an expanded ref or extends link.
        const openModelEl = target.closest('[data-open-model]') as HTMLElement | null;
        if (openModelEl) {
            event.preventDefault();
            event.stopPropagation();
            vscode.postMessage({ type: 'openModel', name: openModelEl.dataset.openModel ?? '' });
            return;
        }

        // Bare `<a class="ce-ref">` (unresolved model) — navigate to the dedicated page.
        const refLink = target.closest('a.ce-ref') as HTMLAnchorElement | null;
        if (refLink) {
            const href = refLink.getAttribute('href') ?? '';
            const match = /^#model-(.+)$/.exec(href);
            if (match) {
                event.preventDefault();
                vscode.postMessage({ type: 'openModel', name: decodeURIComponent(match[1]!) });
                return;
            }
        }

        const jump = target.closest('[data-jump-file]') as HTMLElement | null;
        if (jump) {
            event.preventDefault();
            vscode.postMessage({
                type: 'reveal',
                file: jump.dataset.jumpFile,
                line: jump.dataset.jumpLine ? Number(jump.dataset.jumpLine) : 1,
            });
        }
    });

    vscode.postMessage({ type: 'ready' });
}

function render(data: PreviewData, selection: ItemSelection, tryItBaseUrl: string): void {
    if (!root) return;
    try {
        root.innerHTML = renderItemPage(data, selection, { tryItBaseUrl });
        window.scrollTo(0, 0);
    } catch (err) {
        root.innerHTML = `<pre style="padding:16px;color:#cf222e;white-space:pre-wrap;">Render error: ${esc((err as Error).message)}\n${esc((err as Error).stack ?? '')}</pre>`;
    }
}

function sendTryIt(operationId: string, sendBtn: HTMLButtonElement): void {
    if (!root) return;
    const formEl = sendBtn.closest('form.ce-tryit-form');
    if (!(formEl instanceof HTMLFormElement)) return;

    const opCard = sendBtn.closest('.ce-tryit') as HTMLElement | null;
    if (!opCard) return;

    const fd = new FormData(formEl);
    const get = (name: string): string => (fd.get(name) ?? '').toString().trim();
    const baseUrl = get('baseUrl');

    // Build URL: take the path from the operation card, substitute path params from the form.
    const routePath = inferRoutePath(opCard);
    if (!routePath) {
        renderTryError(operationId, 'Could not determine route path from the form.');
        return;
    }
    const substituted = routePath.replace(/\{([^}]+)\}/g, (_m, name: string) => {
        const v = get(`path.${name}`);
        return v ? encodeURIComponent(v) : `{${name}}`;
    });

    // Collect query and headers.
    const queryParts: string[] = [];
    const headers: Record<string, string> = {};
    let isJsonBody = false;
    let body = '';
    for (const [k, val] of fd.entries()) {
        const value = (val ?? '').toString();
        if (k.startsWith('query.')) {
            if (value) queryParts.push(`${encodeURIComponent(k.slice(6))}=${encodeURIComponent(value)}`);
        } else if (k.startsWith('header.')) {
            if (value) headers[k.slice(7)] = value;
        } else if (k === 'body') {
            body = value;
            if (value.trim().length > 0) isJsonBody = true;
        }
    }
    const url = `${stripTrailingSlash(baseUrl)}${substituted}${queryParts.length > 0 ? `?${queryParts.join('&')}` : ''}`;
    const method = inferMethod(opCard);

    const out = opCard.querySelector(`[data-tryit-response="${cssEscape(operationId)}"]`);
    if (out) out.innerHTML = '<p style="opacity:0.7;">Sending…</p>';
    sendBtn.disabled = true;

    vscode.postMessage({
        type: 'sendRequest',
        request: { operationId, method, url, headers, body, isJsonBody } satisfies {
            operationId: string;
            method: string;
            url: string;
            headers: Record<string, string>;
            body: string;
            isJsonBody: boolean;
        },
    });
}

function renderTryResponse(response: TryResponseMessage['response']): void {
    if (!root) return;
    const out = root.querySelector(`[data-tryit-response="${cssEscape(response.operationId)}"]`);
    const card = root.querySelector(`[data-tryit-id="${cssEscape(response.operationId)}"]`);
    const btn = card?.querySelector('[data-tryit-action="send"]') as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
    if (!out) return;

    if (response.error) {
        out.innerHTML = `<p class="ce-tryit-status" style="color:var(--ce-status-4xx);">Request failed</p><pre class="ce-code">${esc(response.error)}</pre>`;
        return;
    }

    const statusClass = `ce-status-${Math.floor(response.status / 100)}xx`;
    const headerRows = Object.entries(response.headers)
        .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td><code>${esc(v)}</code></td></tr>`)
        .join('');
    out.innerHTML = `
        <p class="ce-tryit-status">
            <span class="ce-status ${statusClass}">${response.status}</span>
            ${esc(response.statusText)} • ${response.bytes} B • ${response.elapsedMs} ms
        </p>
        <details><summary>Response headers (${Object.keys(response.headers).length})</summary>
            <table class="ce-fields"><tbody>${headerRows}</tbody></table>
        </details>
        <details open><summary>Response body</summary>
            <pre class="ce-code"><code>${esc(response.body)}</code></pre>
        </details>
    `;
}

function renderTryError(operationId: string, message: string): void {
    if (!root) return;
    const out = root.querySelector(`[data-tryit-response="${cssEscape(operationId)}"]`);
    if (out) out.innerHTML = `<p style="color:var(--ce-status-4xx);">${esc(message)}</p>`;
}

function inferRoutePath(opCard: HTMLElement): string {
    const path = opCard.closest('.ce-op-card')?.querySelector('.ce-path');
    return path?.textContent ?? '';
}

function inferMethod(opCard: HTMLElement): string {
    const method = opCard.closest('.ce-op-card')?.querySelector('.ce-method');
    return (method?.textContent ?? 'GET').trim().toUpperCase();
}

function stripTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

function esc(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cssEscape(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
}
