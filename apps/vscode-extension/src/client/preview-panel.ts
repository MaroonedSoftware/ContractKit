import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { ItemSelection } from '@contractkit/explorer-ui';
import { operationId } from '@contractkit/explorer-ui';
import type { RevealMessage } from '../shared/protocol.js';
import type { PreviewDataStore } from './preview-data-store.js';
import { getTryItBaseUrl, performTryIt, type TryItRequest } from './try-it-handler.js';
import { getWebviewHtml } from './webview-template.js';

interface OpenModelMessage {
    type: 'openModel';
    name: string;
}

interface OpenOperationMessage {
    type: 'openOperation';
    id: string;
}

interface ReadyMessage {
    type: 'ready';
}

interface SendRequestMessage {
    type: 'sendRequest';
    request: TryItRequest;
}

type IncomingMessage = RevealMessage | OpenModelMessage | OpenOperationMessage | ReadyMessage | SendRequestMessage;

/**
 * One webview panel per unique selection (operation / model / overview). Clicking a different
 * item in the tree opens its own dedicated panel — like opening multiple editor tabs. Clicking
 * the same item again reveals its existing panel instead of duplicating it. Ref-link clicks
 * inside a panel also spawn a new panel for the linked model rather than navigating in place;
 * clicking an endpoint row in the Overview's "Endpoints by area" list similarly spawns a
 * dedicated operation panel.
 */
export class PreviewPanel {
    private static panels = new Map<string, PreviewPanel>();

    static createOrShow(
        context: vscode.ExtensionContext,
        store: PreviewDataStore,
        selection: ItemSelection,
    ): void {
        const key = selectionKey(selection);
        const existing = PreviewPanel.panels.get(key);
        if (existing) {
            existing.panel.reveal(undefined, true);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'contractkitPreviewApi',
            resolveTitle(selection, store),
            { viewColumn: preferredColumn(), preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
            },
        );
        const previewPanel = new PreviewPanel(panel, context, store, selection);
        PreviewPanel.panels.set(key, previewPanel);
    }

    private webviewReady = false;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
        private readonly store: PreviewDataStore,
        private readonly selection: ItemSelection,
    ) {
        const nonce = crypto.randomBytes(16).toString('hex');
        panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri, nonce);

        this.disposables.push(
            panel.webview.onDidReceiveMessage((message: unknown) => this.handleWebviewMessage(message)),
            store.onDidChangeData(() => this.postCurrent()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('contractkit.tryItOut')) this.postCurrent();
            }),
            panel.onDidDispose(() => this.dispose()),
        );
    }

    private postCurrent(): void {
        if (!this.webviewReady) return;
        const data = this.store.getData();
        if (!data) return;
        // Refresh the tab title now that we have data — at panel-creation time the store may
        // not have loaded yet, leaving operations to fall back to their stable id.
        this.panel.title = resolveTitle(this.selection, this.store);
        this.panel.webview.postMessage({
            type: 'render',
            data,
            selection: this.selection,
            tryItBaseUrl: getTryItBaseUrl(),
        });
    }

    private handleWebviewMessage(message: unknown): void {
        if (!message || typeof message !== 'object') return;
        const msg = message as IncomingMessage;
        switch (msg.type) {
            case 'ready':
                this.webviewReady = true;
                // Post cached data immediately if we have any so the user isn't stuck on
                // Loading…. The cache is only built post-indexing (server side), so this is
                // safe. The refresh below keeps it fresh.
                if (this.store.getData()) this.postCurrent();
                void this.store.refresh();
                return;
            case 'reveal':
                void this.revealSource(msg);
                return;
            case 'openModel':
                // Open the linked model in its own panel — reveals if already open.
                PreviewPanel.createOrShow(this.context, this.store, { kind: 'model', name: msg.name });
                return;
            case 'openOperation':
                PreviewPanel.createOrShow(this.context, this.store, { kind: 'operation', id: msg.id });
                return;
            case 'sendRequest':
                void this.handleTryIt(msg.request);
                return;
        }
    }

    private async handleTryIt(request: TryItRequest): Promise<void> {
        const response = await performTryIt(request);
        this.panel.webview.postMessage({ type: 'tryResponse', response });
    }

    private async revealSource({ file, line }: RevealMessage): Promise<void> {
        if (!file || typeof file !== 'string') return;
        const safeLine = Math.max(0, (typeof line === 'number' ? line : 1) - 1);
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
            const range = new vscode.Range(safeLine, 0, safeLine, 0);
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                selection: range,
            });
        } catch {
            // File missing or unopenable — silently ignore.
        }
    }

    private dispose(): void {
        const key = selectionKey(this.selection);
        if (PreviewPanel.panels.get(key) === this) PreviewPanel.panels.delete(key);
        for (const d of this.disposables) d.dispose();
    }
}

/** Stable key per selection so reopening the same item reveals its existing panel. */
function selectionKey(selection: ItemSelection): string {
    switch (selection.kind) {
        case 'overview': return 'overview';
        case 'operation': return `op:${selection.id}`;
        case 'model': return `model:${selection.name}`;
    }
}

/**
 * Best-effort human title for the tab. For operations, looks up the resolved op in the store
 * to display `METHOD /path` or the op's name. Falls back to the selection id when data is
 * unavailable (e.g. the store hasn't loaded yet at panel creation time).
 */
function resolveTitle(selection: ItemSelection, store: PreviewDataStore): string {
    if (selection.kind === 'overview') return 'ContractKit Overview';
    if (selection.kind === 'model') return selection.name;
    const data = store.getData();
    const op = data?.operations.find(o => operationId(o) === selection.id);
    if (!op) return selection.id;
    return op.op.name ?? `${op.method.toUpperCase()} ${op.routePath}`;
}

/**
 * Pick the column to open the preview in. If a text editor is active, split beside it so the
 * code and the docs sit side-by-side. Otherwise open in column One so the panel fills the
 * editor area instead of creating an empty group beside an invisible "active" column.
 */
function preferredColumn(): vscode.ViewColumn {
    return vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
}
