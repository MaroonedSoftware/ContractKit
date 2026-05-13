import * as vscode from 'vscode';
import type { PreviewDataStore } from './preview-data-store.js';

/** Status bar item that surfaces the current API title and endpoint count. Click to focus the tree. */
export function createApiStatusBar(store: PreviewDataStore): vscode.Disposable {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    item.command = 'contractkit.previewApi';
    item.tooltip = 'ContractKit: open API explorer';

    const update = (): void => {
        const data = store.getData();
        if (!data) {
            item.text = '$(book) ContractKit';
            item.hide();
            return;
        }
        const endpoints = data.operations.length;
        const models = data.models.length;
        if (endpoints === 0 && models === 0) {
            item.hide();
            return;
        }
        item.text = `$(book) ${data.configMeta.title} • ${endpoints} ep / ${models} models`;
        if (data.warnings.length > 0) {
            item.text += ` $(warning)`;
            item.tooltip = new vscode.MarkdownString(
                `**${data.configMeta.title}** v${data.configMeta.version}\n\n${endpoints} endpoint${endpoints === 1 ? '' : 's'}, ${models} model${models === 1 ? '' : 's'}\n\n⚠ ${data.warnings.length} warning${data.warnings.length === 1 ? '' : 's'}`,
            );
        } else {
            item.tooltip = new vscode.MarkdownString(
                `**${data.configMeta.title}** v${data.configMeta.version}\n\n${endpoints} endpoint${endpoints === 1 ? '' : 's'}, ${models} model${models === 1 ? '' : 's'}`,
            );
        }
        item.show();
    };

    const subscription = store.onDidChangeData(update);
    update();

    return new vscode.Disposable(() => {
        subscription.dispose();
        item.dispose();
    });
}
