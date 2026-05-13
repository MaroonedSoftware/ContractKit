import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node.js';
import type { ItemSelection } from '@contractkit/explorer-ui';
import { operationId } from '@contractkit/explorer-ui';
import { PREVIEW_DATA_CHANGED_NOTIFICATION } from '../shared/protocol.js';
import { ApiTreeProvider, type GroupingMode } from './api-tree-provider.js';
import { buildCurl, revealSelectionSource } from './commands.js';
import { PreviewDataStore } from './preview-data-store.js';
import { PreviewPanel } from './preview-panel.js';
import { createApiStatusBar } from './status-bar.js';
import { getTryItBaseUrl } from './try-it-handler.js';

const GROUPING_STATE_KEY = 'contractkit.apiExplorer.grouping';
const GROUPING_LABELS: Record<GroupingMode, string> = {
    file: 'Group by file',
    area: 'Group by service area',
    method: 'Group by HTTP method',
    flat: 'No grouping',
};

let client: LanguageClient | undefined;

/**
 * Activates the ContractKit extension. Starts the LSP client, wires the API Explorer tree view,
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
    };

    client = new LanguageClient('contractDsl', 'Contract DSL Language Server', serverOptions, clientOptions);

    await client.start();

    const store = new PreviewDataStore(client);
    const treeProvider = new ApiTreeProvider(store);

    const persistedGrouping = context.workspaceState.get<GroupingMode>(GROUPING_STATE_KEY);
    if (persistedGrouping) treeProvider.setGrouping(persistedGrouping);

    const treeView = vscode.window.createTreeView('contractkit.apiExplorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    const statusBar = createApiStatusBar(store);

    context.subscriptions.push(
        treeView,
        statusBar,

        vscode.commands.registerCommand('contractkit.openApiItem', (selection?: ItemSelection) => {
            const target: ItemSelection = selection ?? { kind: 'overview' };
            PreviewPanel.createOrShow(context, store, target);
        }),

        vscode.commands.registerCommand('contractkit.previewApi', async () => {
            await vscode.commands.executeCommand('contractkit.apiExplorer.focus');
            PreviewPanel.createOrShow(context, store, { kind: 'overview' });
        }),

        vscode.commands.registerCommand('contractkit.refreshApiExplorer', () => {
            void store.refresh();
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

        vscode.commands.registerCommand('contractkit.filterApiExplorer', async () => {
            const value = await vscode.window.showInputBox({
                prompt: 'Filter API Explorer (path, name, sdk, service, method)',
                placeHolder: 'e.g. payments, GET, getPayment',
                value: treeProvider.getFilter(),
            });
            if (value === undefined) return;
            treeProvider.setFilter(value);
        }),

        vscode.commands.registerCommand('contractkit.clearApiFilter', () => {
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
