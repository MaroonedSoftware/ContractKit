import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node.js';
import type { PreviewData } from '@contractkit/explorer-ui';
import { PREVIEW_DATA_REQUEST } from '../shared/protocol.js';

/**
 * Cached, refreshable PreviewData fetched from the LSP server. Emits a change event after every
 * successful refresh so the tree view and the detail panel both stay in sync.
 */
export class PreviewDataStore {
    private cached: PreviewData | undefined;
    private inflight: Promise<PreviewData | undefined> | undefined;
    private readonly _onDidChange = new vscode.EventEmitter<PreviewData>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly client: LanguageClient) {}

    getData(): PreviewData | undefined {
        return this.cached;
    }

    onDidChangeData(listener: (data: PreviewData) => void): vscode.Disposable {
        return this._onDidChange.event(listener);
    }

    async refresh(): Promise<PreviewData | undefined> {
        if (this.inflight) return this.inflight;
        this.inflight = (async () => {
            try {
                const data = await this.client.sendRequest<PreviewData>(PREVIEW_DATA_REQUEST);
                this.cached = data;
                this._onDidChange.fire(data);
                return data;
            } catch {
                return undefined;
            } finally {
                this.inflight = undefined;
            }
        })();
        return this.inflight;
    }
}
