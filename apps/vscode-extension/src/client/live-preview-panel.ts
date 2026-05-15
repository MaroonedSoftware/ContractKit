import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { ItemSelection } from '@contractkit/explorer-ui';
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
 * Singleton live-preview panel that follows the active text editor — matches the VS Code
 * Markdown "Open Preview to the Side" UX. When the user focuses a `.ck` file the panel shows
 * every operation and model declared in that file; when they focus a non-ck file the panel
 * holds the last-rendered view (so the docs don't disappear while you tab over to a service
 * file to look something up). Always one of these exists at most.
 *
 * Per-item panels (operation/model detail tabs spawned from tree clicks) live in PreviewPanel
 * and remain independent of this one.
 */
export class LivePreviewPanel {
    private static current: LivePreviewPanel | undefined;

    /**
     * Reveals the live-preview panel, creating it if one isn't already open. After revealing,
     * the panel re-syncs to the currently focused editor so it shows whichever `.ck` file is
     * active when the command runs.
     */
    static createOrShow(context: vscode.ExtensionContext, store: PreviewDataStore): void {
        if (LivePreviewPanel.current) {
            LivePreviewPanel.current.panel.reveal(undefined, true);
            LivePreviewPanel.current.syncToActiveEditor();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'contractkitLivePreview',
            'ContractKit Preview',
            { viewColumn: preferredColumn(), preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
            },
        );
        LivePreviewPanel.current = new LivePreviewPanel(panel, context, store);
    }

    private currentSelection: ItemSelection = { kind: 'overview' };
    private webviewReady = false;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        private readonly store: PreviewDataStore,
    ) {
        const nonce = crypto.randomBytes(16).toString('hex');
        panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri, nonce);

        this.syncToActiveEditor();

        this.disposables.push(
            panel.webview.onDidReceiveMessage((message: unknown) => this.handleWebviewMessage(message)),
            store.onDidChangeData(() => this.postCurrent()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('contractkit.tryItOut')) this.postCurrent();
            }),
            // Track the active editor — switch the preview to whichever `.ck` file is focused.
            vscode.window.onDidChangeActiveTextEditor(() => this.syncToActiveEditor()),
            panel.onDidDispose(() => this.dispose()),
        );
    }

    private syncToActiveEditor(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'contract-ck') {
            const path = editor.document.uri.fsPath;
            // Skip re-posting if we're already showing this file.
            if (this.currentSelection.kind === 'file' && this.currentSelection.path === path) return;
            this.currentSelection = { kind: 'file', path };
            this.panel.title = `Preview: ${path.split('/').pop() ?? path}`;
            this.postCurrent();
        }
        // Non-ck editor focused: hold the last view rather than blanking the panel.
    }

    private postCurrent(): void {
        if (!this.webviewReady) return;
        const data = this.store.getData();
        if (!data) return;
        this.panel.webview.postMessage({
            type: 'render',
            data,
            selection: this.currentSelection,
            tryItBaseUrl: getTryItBaseUrl(),
        });
    }

    private handleWebviewMessage(message: unknown): void {
        if (!message || typeof message !== 'object') return;
        const msg = message as IncomingMessage;
        switch (msg.type) {
            case 'ready':
                this.webviewReady = true;
                // Post whatever's cached so the user sees content immediately (cache is only
                // built from data the server returned AFTER indexing, so it's reliable).
                if (this.store.getData()) this.postCurrent();
                // Refresh anyway to pick up any changes since the cache was populated. The
                // onDidChangeData listener re-renders with the fresh snapshot when it arrives.
                void this.store.refresh();
                return;
            case 'reveal':
                void this.revealSource(msg);
                return;
            case 'openModel':
                // Ref link → spawn a dedicated per-item panel (handled by PreviewPanel elsewhere
                // to keep the live preview anchored to the file).
                void vscode.commands.executeCommand('contractkit.openApiItem', {
                    kind: 'model',
                    name: msg.name,
                });
                return;
            case 'openOperation':
                void vscode.commands.executeCommand('contractkit.openApiItem', {
                    kind: 'operation',
                    id: msg.id,
                });
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
        if (LivePreviewPanel.current === this) LivePreviewPanel.current = undefined;
        for (const d of this.disposables) d.dispose();
    }
}

/** Open beside the active editor; fall back to column Two when no editor is open. */
function preferredColumn(): vscode.ViewColumn {
    return vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Two;
}
