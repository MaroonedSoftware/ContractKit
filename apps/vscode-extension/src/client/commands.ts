import * as vscode from 'vscode';
import type { ItemSelection } from '@contractkit/explorer-ui';
import { locateItem } from './api-item-utils.js';
import type { PreviewDataStore } from './preview-data-store.js';

/** Reveals the source location for an item selection in the editor view column. No-op when the selection has no source. */
export async function revealSelectionSource(store: PreviewDataStore, selection: ItemSelection | undefined): Promise<void> {
    if (!selection) return;
    const data = store.getData();
    if (!data) return;
    const loc = locateItem(data, selection);
    if (!loc) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(loc.file));
    const range = new vscode.Range(Math.max(0, loc.line - 1), 0, Math.max(0, loc.line - 1), 0);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: range });
}

export { buildCurl, locateItem } from './api-item-utils.js';
