import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node.js';
import type { ItemSelection } from '@contractkit/explorer-ui';
import { operationId } from '@contractkit/explorer-ui';
import { PREVIEW_DATA_CHANGED_NOTIFICATION, REINDEX_WORKSPACE_REQUEST } from '../shared/protocol.js';
import { ApiTreeProvider, type GroupingMode } from './api-tree-provider.js';
import { buildCurl, revealSelectionSource } from './commands.js';
import { LivePreviewPanel } from './live-preview-panel.js';
import { PreviewDataStore } from './preview-data-store.js';
import { PreviewPanel } from './preview-panel.js';
import { createApiStatusBar } from './status-bar.js';
import { getTryItBaseUrl } from './try-it-handler.js';

const GROUPING_STATE_KEY = 'contractkit.explorer.grouping';
const GROUPING_LABELS: Record<GroupingMode, string> = {
    file: 'Group by file',
    area: 'Group by service area',
    method: 'Group by HTTP method',
    flat: 'No grouping',
};
const DETECTION_GLOB = '{**/*.ck,**/contractkit.config.json}';
const DETECTION_EXCLUDE = '**/node_modules/**';

let client: LanguageClient | undefined;

async function probeDetected(): Promise<boolean> {
    const matches = await vscode.workspace.findFiles(DETECTION_GLOB, DETECTION_EXCLUDE, 1);
    return matches.length > 0;
}

/**
 * Activates the ContractKit extension. Starts the LSP client, wires the Explorer tree view,
 * status bar, status notifications, and all `contractkit.*` commands. Resolves after the LSP
 * client is fully started so command handlers can issue requests immediately.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.js'));

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'contract-ck' }],
        synchronize: {
            // Forward `.ck` and config file events to the server so it can re-index files
            // that aren't currently open in an editor (external edits, git operations, etc.).
            // Without this, `connection.onDidChangeWatchedFiles` on the server never fires
            // and the workspace index goes stale.
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/*.ck'),
                vscode.workspace.createFileSystemWatcher('**/contractkit.config.json'),
            ],
        },
    };

    client = new LanguageClient('contractDsl', 'Contract DSL Language Server', serverOptions, clientOptions);

    await client.start();

    let detected: boolean | undefined;
    const setDetected = async (value: boolean): Promise<void> => {
        if (detected === value) return;
        detected = value;
        await vscode.commands.executeCommand('setContext', 'contractkit.detected', value);
    };

    await setDetected(await probeDetected());

    const watcher = vscode.workspace.createFileSystemWatcher(DETECTION_GLOB, false, true, false);
    watcher.onDidCreate(() => void setDetected(true));
    watcher.onDidDelete(async () => {
        await setDetected(await probeDetected());
    });

    const store = new PreviewDataStore(client);
    const treeProvider = new ApiTreeProvider(store);

    const persistedGrouping = context.workspaceState.get<GroupingMode>(GROUPING_STATE_KEY);
    if (persistedGrouping) treeProvider.setGrouping(persistedGrouping);

    const treeView = vscode.window.createTreeView('contractkit.explorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    const visibilitySubscription = treeView.onDidChangeVisibility(e => {
        if (e.visible) void store.refresh();
    });

    const statusBar = createApiStatusBar(store);

    context.subscriptions.push(
        treeView,
        visibilitySubscription,
        statusBar,
        watcher,

        vscode.commands.registerCommand('contractkit.openApiItem', (selection?: ItemSelection) => {
            const target: ItemSelection = selection ?? { kind: 'overview' };
            // Don't pre-check existence here — the cached store can be stale relative to the
            // workspace, and a false negative would block opening a panel for a model that's
            // really there. The PreviewPanel listens for store updates after creation and will
            // render the model as soon as it appears (or show its own missing-model state).
            PreviewPanel.createOrShow(context, store, target);
        }),

        vscode.commands.registerCommand('contractkit.previewApi', () => {
            // "Open Preview to the Side" — singleton panel that follows the active `.ck` editor.
            LivePreviewPanel.createOrShow(context, store);
        }),

        vscode.commands.registerCommand('contractkit.openOverview', async () => {
            try {
                await vscode.commands.executeCommand('contractkit.explorer.focus');
            } catch {
                // ignore — the panel still opens below.
            }
            PreviewPanel.createOrShow(context, store, { kind: 'overview' });
        }),

        vscode.commands.registerCommand('contractkit.refreshExplorer', async () => {
            // Force the server to drop its in-memory index and re-walk every `.ck` file on
            // disk. The server emits a PREVIEW_DATA_CHANGED notification once indexing
            // finishes, which kicks off the store refresh — but call refresh() directly too
            // so the user gets a snapshot even if the notification race-fails.
            try {
                await client?.sendRequest(REINDEX_WORKSPACE_REQUEST);
            } catch {
                // Ignore — fall back to a local refresh below.
            }
            await store.refresh();
        }),

        vscode.commands.registerCommand('contractkit.revealApiItemSource', async (arg?: ItemSelection) => {
            await revealSelectionSource(store, arg);
        }),

        vscode.commands.registerCommand('contractkit.copyApiItemPath', async (arg?: ItemSelection) => {
            const data = store.getData();
            if (!data || !arg) return;
            if (arg.kind === 'operation') {
                const op = data.operations.find(o => operationId(o) === arg.id);
                if (op) await vscode.env.clipboard.writeText(`${op.method.toUpperCase()} ${op.routePath}`);
            } else if (arg.kind === 'model') {
                await vscode.env.clipboard.writeText(arg.name);
            }
        }),

        vscode.commands.registerCommand('contractkit.copyApiItemCurl', async (arg?: ItemSelection) => {
            const data = store.getData();
            if (!data || !arg || arg.kind !== 'operation') return;
            const op = data.operations.find(o => operationId(o) === arg.id);
            if (!op) return;
            const baseUrl = getTryItBaseUrl() || 'https://api.example.com';
            await vscode.env.clipboard.writeText(buildCurl(op, baseUrl));
            vscode.window.showInformationMessage(`Copied cURL for ${op.method.toUpperCase()} ${op.routePath}`);
        }),

        vscode.commands.registerCommand('contractkit.setGrouping', async () => {
            const items = (Object.entries(GROUPING_LABELS) as [GroupingMode, string][]).map(([id, label]) => ({
                label,
                id,
                picked: treeProvider.getGrouping() === id,
            }));
            const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Group endpoints by…' });
            if (!pick) return;
            treeProvider.setGrouping(pick.id);
            await context.workspaceState.update(GROUPING_STATE_KEY, pick.id);
        }),

        vscode.commands.registerCommand('contractkit.filterExplorer', async () => {
            const value = await vscode.window.showInputBox({
                prompt: 'Filter Explorer (path, name, sdk, service, method)',
                placeHolder: 'e.g. payments, GET, getPayment',
                value: treeProvider.getFilter(),
            });
            if (value === undefined) return;
            treeProvider.setFilter(value);
        }),

        vscode.commands.registerCommand('contractkit.clearExplorerFilter', () => {
            treeProvider.setFilter('');
        }),
    );

    client.onNotification(PREVIEW_DATA_CHANGED_NOTIFICATION, () => {
        void store.refresh();
    });

    void store.refresh();
}

/** Tears down the LSP client. Returns the underlying promise so VS Code can await shutdown. */
export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
