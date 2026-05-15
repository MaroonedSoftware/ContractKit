import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath } from 'node:url';
import { Connection, Diagnostic as LspDiagnostic } from 'vscode-languageserver';
import { parseCk, DiagnosticCollector } from '@contractkit/core';
import type { CkRootNode, Diagnostic } from '@contractkit/core';
import { toLspDiagnostics } from './diagnostics-adapter.js';

/** Cached parse of a single open document. `version` matches the `TextDocument` version at parse time. */
export type ParsedDocument = { ast: CkRootNode; version: number };

/** Owns parsed-AST state for every open `.ck` document and publishes diagnostics to the LSP client.
 * Reparses are debounced per-URI so a burst of edits collapses into a single parse. */
export class DocumentManager {
    private cache = new Map<string, ParsedDocument>();
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Parse diagnostics from the most recent successful parse of each URI. */
    private parseDiagnostics = new Map<string, Diagnostic[]>();
    /** Optional listener fired after `parseAndPublish` finishes (used by the project validator to re-run cross-file checks). */
    private onParsedListener?: (uri: string) => void;

    constructor(private connection: Connection) {}

    /** Register a callback fired whenever a document finishes parsing. Used by the project validator
     * to refresh cross-file diagnostics on every parse. Pass `undefined` to clear. */
    setOnParsed(listener: ((uri: string) => void) | undefined): void {
        this.onParsedListener = listener;
    }

    /** Parse-time diagnostics for `uri`, or `[]` if the document has never been parsed. */
    getParseDiagnostics(uri: string): Diagnostic[] {
        return this.parseDiagnostics.get(uri) ?? [];
    }

    /** Latest successfully parsed AST for `uri`, or `undefined` if the document hasn't parsed yet. */
    getDocument(uri: string): ParsedDocument | undefined {
        return this.cache.get(uri);
    }

    /** All currently cached parses, keyed by document URI. */
    getAllDocuments(): Map<string, ParsedDocument> {
        return this.cache;
    }

    /** Queue a reparse for `document`, coalescing rapid edits into a single parse after a short delay. */
    scheduleReparse(document: TextDocument): void {
        const uri = document.uri;
        const existing = this.debounceTimers.get(uri);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
            uri,
            setTimeout(() => {
                this.debounceTimers.delete(uri);
                this.parseAndPublish(document);
            }, 150),
        );
    }

    /** Parse `document` immediately, cache the AST on success, and publish diagnostics to the client.
     * Parse-time crashes are swallowed so any diagnostics the collector did capture still reach the editor. */
    parseAndPublish(document: TextDocument): void {
        const uri = document.uri;
        const text = document.getText();
        const diag = new DiagnosticCollector();
        const filePath = uriToFilePath(uri);

        try {
            const ast = parseCk(text, filePath, diag);
            this.cache.set(uri, { ast, version: document.version });
        } catch {
            // If parsing crashes entirely, still report collected diagnostics
        }

        const parseDiags = diag.getAll();
        this.parseDiagnostics.set(uri, parseDiags);
        const lspDiagnostics: LspDiagnostic[] = toLspDiagnostics(parseDiags, text);
        this.connection.sendDiagnostics({ uri, diagnostics: lspDiagnostics });
        this.onParsedListener?.(uri);
    }

    /** Drop cached state for `uri` (called on document close) and clear its diagnostics in the client. */
    removeDocument(uri: string): void {
        this.cache.delete(uri);
        this.parseDiagnostics.delete(uri);
        const timer = this.debounceTimers.get(uri);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(uri);
        }
        this.connection.sendDiagnostics({ uri, diagnostics: [] });
    }
}

function uriToFilePath(uri: string): string {
    try {
        return fileURLToPath(uri);
    } catch {
        return uri;
    }
}
