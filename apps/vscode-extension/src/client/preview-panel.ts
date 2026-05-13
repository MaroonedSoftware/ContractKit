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

interface ReadyMessage {
    type: 'ready';
}

interface SendRequestMessage {
    type: 'sendRequest';
    request: TryItRequest;
}

type IncomingMessage = RevealMessage | OpenModelMessage | ReadyMessage | SendRequestMessage;

/**
 * Singleton webview panel for the API explorer detail view. Renders a single operation / model /
 * overview, handles in-panel ref-link navigation, and proxies Try-it HTTP requests through the
 * extension host so the webview's strict CSP doesn't have to allow external origins.
 */
export class PreviewPanel {
    static currentPanel: PreviewPanel | undefined;

    static createOrShow(
        context: vscode.ExtensionContext,
        store: PreviewDataStore,
        selection: ItemSelection,
    ): void {
        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside, true);
            PreviewPanel.currentPanel.show(selection);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'contractkitPreviewApi',
            getPanelTitle(selection),
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
            },
        );
        PreviewPanel.currentPanel = new PreviewPanel(panel, context, store, selection);
    }

    private currentSelection: ItemSelection;
    private webviewReady = false;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        private readonly store: PreviewDataStore,
        selection: ItemSelection,
    ) {
        this.currentSelection = selection;
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

    show(selection: ItemSelection): void {
        this.currentSelection = selection;
        this.panel.title = getPanelTitle(selection);
        this.postCurrent();
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
                if (this.store.getData()) {
                    this.postCurrent();
                } else {
                    void this.store.refresh();
                }
                return;
            case 'reveal':
                void this.revealSource(msg);
                return;
            case 'openModel':
                this.show({ kind: 'model', name: msg.name });
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
        if (PreviewPanel.currentPanel === this) PreviewPanel.currentPanel = undefined;
        for (const d of this.disposables) d.dispose();
    }
}

function getPanelTitle(selection: ItemSelection): string {
    if (selection.kind === 'model') return `${selection.name} — ContractKit API`;
    return 'ContractKit API';
}
