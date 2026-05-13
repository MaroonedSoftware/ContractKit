import type { PreviewData } from '@contractkit/explorer-ui';

/** LSP method name for the request that returns a workspace-wide PreviewData snapshot. */
export const PREVIEW_DATA_REQUEST = 'contractkit/previewData' as const;

/** Server → client notification fired (debounced) whenever the workspace's PreviewData would change. */
export const PREVIEW_DATA_CHANGED_NOTIFICATION = 'contractkit/previewDataChanged' as const;

/** Convenience alias for the response shape of {@link PREVIEW_DATA_REQUEST}. */
export type PreviewDataResponse = PreviewData;

/** Webview → extension message asking VS Code to reveal the given `.ck` source location. */
export interface RevealMessage {
    type: 'reveal';
    file: string;
    line: number;
}

/** Extension → webview message carrying a fresh PreviewData snapshot for rendering. */
export interface DataMessage {
    type: 'data';
    data: PreviewData;
}
