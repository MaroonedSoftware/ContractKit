import { pathToFileURL, fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { Connection, Diagnostic as LspDiagnostic } from 'vscode-languageserver';
import { validateProject, DiagnosticCollector } from '@contractkit/core';
import type { CkRootNode, Diagnostic } from '@contractkit/core';
import { toLspDiagnostics } from './diagnostics-adapter.js';
import type { DocumentManager } from './document-manager.js';
import type { WorkspaceIndex } from './workspace-index.js';
import type { WorkspaceConfigCache } from './workspace-config.js';

/** Default debounce window for cross-file diagnostic refresh. */
export const PROJECT_VALIDATE_DEBOUNCE_MS = 200;

export interface ProjectValidatorOptions {
    /** Open documents keyed by URI. Used to map URIs back to text for the LSP range-clamping step. */
    getOpenDocumentText: (uri: string) => string | undefined;
    /** Override the debounce delay. Tests pass `0` to make validation synchronous. */
    debounceMs?: number;
}

/**
 * Runs the contractkit cross-file validation pipeline ({@link validateProject})
 * against every parsed `.ck` AST the LSP currently knows about and publishes
 * combined parse + cross-file diagnostics per URI.
 *
 * Combines two diagnostic streams:
 *
 * - **Parse diagnostics** — captured by {@link DocumentManager} when a document
 *   is reparsed; cached on the document manager and read back here.
 * - **Cross-file diagnostics** — `validateRefs`, `validateInheritance`,
 *   `validateOp`, plus warnings from `applyOptionsDefaults` /
 *   `applyVariableSubstitution`. Produced by `validateProject` on every run.
 *
 * The validator owns publication for any URI it has previously published, so
 * a file that gained and then lost a cross-file error gets its diagnostics
 * cleared. ASTs are deep-cloned before normalization so the pipeline's
 * in-place mutations never leak back into the workspace index or
 * `DocumentManager` cache.
 */
export class ProjectValidator {
    private debounceTimer: NodeJS.Timeout | undefined;
    private readonly debounceMs: number;
    /** URIs we've previously published diagnostics for. Used to clear stale errors on subsequent runs. */
    private publishedUris = new Set<string>();

    constructor(
        private readonly connection: Connection,
        private readonly documentManager: DocumentManager,
        private readonly workspaceIndex: WorkspaceIndex,
        private readonly configCache: WorkspaceConfigCache,
        private readonly options: ProjectValidatorOptions,
    ) {
        this.debounceMs = options.debounceMs ?? PROJECT_VALIDATE_DEBOUNCE_MS;
    }

    /** Trigger a debounced project validation. Multiple calls within the debounce window collapse to a single run. */
    schedule(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.debounceMs <= 0) {
            this.validate();
            return;
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.validate();
        }, this.debounceMs);
    }

    /** Run the full validation pipeline now and publish merged diagnostics. Exposed for tests; production code calls `schedule()`. */
    validate(): void {
        const collected = this.collectAsts();
        const diag = new DiagnosticCollector();

        try {
            validateProject({
                files: collected.map(c => ({ filePath: c.filePath, ast: c.clonedAst })),
                getKeysForFile: filePath => this.configCache.getKeysForFile(filePath),
                diag,
            });
        } catch {
            // Pipeline crashes should never break the editor — fall through and publish whatever we collected.
        }

        const crossFileByPath = groupDiagnosticsByFile(diag.getAll());
        const allUris = new Set<string>(this.publishedUris);
        for (const { filePath } of collected) allUris.add(filePathToUri(filePath));

        for (const uri of allUris) {
            const filePath = uriToFilePath(uri);
            const parseDiags = this.documentManager.getParseDiagnostics(uri);
            const crossFileDiags = crossFileByPath.get(filePath) ?? [];
            const merged = mergeDiagnostics(parseDiags, crossFileDiags);
            const text = this.options.getOpenDocumentText(uri) ?? readSourceForRange(filePath);
            const lspDiags: LspDiagnostic[] = toLspDiagnostics(merged, text);
            this.connection.sendDiagnostics({ uri, diagnostics: lspDiags });
            if (merged.length > 0) this.publishedUris.add(uri);
            else this.publishedUris.delete(uri);
        }
    }

    /** Snapshot every AST the validator can see. Open-doc ASTs win over on-disk index ASTs for the same file. */
    private collectAsts(): { filePath: string; clonedAst: CkRootNode }[] {
        const out = new Map<string, { filePath: string; clonedAst: CkRootNode }>();

        for (const { filePath, ast } of this.workspaceIndex.getAllAsts()) {
            const cloned = safeClone(ast);
            if (cloned) out.set(filePath, { filePath, clonedAst: cloned });
        }
        for (const [uri, parsed] of this.documentManager.getAllDocuments()) {
            const filePath = uriToFilePath(uri);
            const cloned = safeClone(parsed.ast);
            if (cloned) out.set(filePath, { filePath, clonedAst: cloned });
        }
        return [...out.values()];
    }
}

function safeClone(ast: CkRootNode): CkRootNode | undefined {
    try {
        return structuredClone(ast);
    } catch {
        return undefined;
    }
}

function groupDiagnosticsByFile(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
    const out = new Map<string, Diagnostic[]>();
    for (const d of diagnostics) {
        const list = out.get(d.file);
        if (list) list.push(d);
        else out.set(d.file, [d]);
    }
    return out;
}

/** Drop duplicates while preserving order: parse first, then cross-file. */
function mergeDiagnostics(parse: Diagnostic[], crossFile: Diagnostic[]): Diagnostic[] {
    const seen = new Set<string>();
    const merged: Diagnostic[] = [];
    for (const d of [...parse, ...crossFile]) {
        const key = `${d.severity}|${d.line}|${d.message}|${d.code ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(d);
    }
    return merged;
}

function filePathToUri(filePath: string): string {
    return pathToFileURL(filePath).toString();
}

function uriToFilePath(uri: string): string {
    try {
        return fileURLToPath(uri);
    } catch {
        return uri;
    }
}

/** Best-effort read of a file's text so the diagnostics adapter can clamp ranges to actual line lengths. */
function readSourceForRange(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}
