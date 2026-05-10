import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    DidChangeWatchedFilesParams,
    FileChangeType,
} from 'vscode-languageserver/node.js';
import { fileURLToPath } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentManager } from './document-manager.js';
import { WorkspaceIndex } from './workspace-index.js';
import { getDocumentSymbols } from './symbol-provider.js';
import { getDefinition } from './definition-provider.js';
import { getHover } from './hover-provider.js';
import { getCompletions } from './completion-provider.js';
import { getWorkspaceSymbols } from './workspace-symbol-provider.js';
import { getFormattingEdits } from './formatting-provider.js';
import { getDocumentLinks } from './document-link-provider.js';
import { getFoldingRanges } from './folding-provider.js';
import { getReferences, getDocumentHighlights } from './references-provider.js';
import { getCodeLenses, resolveCodeLens } from './codelens-provider.js';
import { prepareRename, getRenameEdits } from './rename-provider.js';
import { getCodeActions } from './code-action-provider.js';
import { getSignatureHelp } from './signature-help-provider.js';
import { getInlayHints } from './inlay-hint-provider.js';
import { getSemanticTokens, SEMANTIC_TOKENS_LEGEND } from './semantic-tokens-provider.js';
import { loadWorkspaceFallbackKeys } from './workspace-config.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const documentManager = new DocumentManager(connection);
const workspaceIndex = new WorkspaceIndex();
let workspaceFallbackKeys: Record<string, string> = {};

connection.onInitialize((params: InitializeParams): InitializeResult => {
    // Index workspace folders on startup
    const folders = params.workspaceFolders;
    if (folders) {
        const paths = folders.map(f => fileURLToPath(f.uri));
        workspaceFallbackKeys = loadWorkspaceFallbackKeys(paths);
        workspaceIndex.indexWorkspace(paths).catch(() => {
            // Silent failure on initial indexing
        });
    }

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            completionProvider: {
                triggerCharacters: [':', '/', '(', ',', '|', '&', ' '],
            },
            hoverProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            documentFormattingProvider: true,
            documentLinkProvider: { resolveProvider: false },
            foldingRangeProvider: true,
            referencesProvider: true,
            documentHighlightProvider: true,
            codeLensProvider: { resolveProvider: true },
            renameProvider: { prepareProvider: true },
            codeActionProvider: { codeActionKinds: ['quickfix'] },
            signatureHelpProvider: { triggerCharacters: ['(', ','] },
            inlayHintProvider: { resolveProvider: false },
            semanticTokensProvider: {
                legend: SEMANTIC_TOKENS_LEGEND,
                full: true,
                range: false,
            },
        },
    };
});

// Reparse and push diagnostics on document change
documents.onDidChangeContent(change => {
    documentManager.scheduleReparse(change.document);
    // Also update workspace index with latest source
    workspaceIndex.indexFromSource(change.document.uri, change.document.getText());
});

// Clean up on document close
documents.onDidClose(event => {
    documentManager.removeDocument(event.document.uri);
});

// Watch for file system changes (saves, creates, deletes of .ck files)
connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
    for (const change of params.changes) {
        const filePath = fileURLToPath(change.uri);
        if (change.type === FileChangeType.Deleted) {
            workspaceIndex.removeFile(change.uri);
        } else {
            workspaceIndex.indexFile(filePath);
        }
    }
});

// Document symbols (Outline panel)
connection.onDocumentSymbol(params => {
    const parsed = documentManager.getDocument(params.textDocument.uri);
    if (!parsed) return [];
    return getDocumentSymbols(parsed);
});

// Go to definition
connection.onDefinition(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getDefinition(params, document, workspaceIndex);
});

// Hover
connection.onHover(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getHover(params, document, workspaceIndex);
});

// Auto-completion
connection.onCompletion(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getCompletions(params, document, workspaceIndex);
});

// Workspace symbols (Cmd+T)
connection.onWorkspaceSymbol(params => {
    return getWorkspaceSymbols(params, workspaceIndex);
});

// Document formatting (Format Document)
connection.onDocumentFormatting(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getFormattingEdits(params, document);
});

// Document links (Cmd+click on file:// / https:// strings)
connection.onDocumentLinks(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const parsed = documentManager.getDocument(params.textDocument.uri);
    return getDocumentLinks(params, document, parsed, workspaceFallbackKeys);
});

// Folding ranges
connection.onFoldingRanges(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getFoldingRanges(params, document);
});

// Find all references
connection.onReferences(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getReferences(params, document, workspaceIndex);
});

// Document highlights (in-file occurrences for the identifier under the cursor)
connection.onDocumentHighlight(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getDocumentHighlights(params, document, workspaceIndex);
});

// CodeLens — reference counts above each declaration
connection.onCodeLens(params => {
    const parsed = documentManager.getDocument(params.textDocument.uri);
    if (!parsed) return [];
    return getCodeLenses(params, parsed, workspaceIndex);
});

connection.onCodeLensResolve(lens => resolveCodeLens(lens, workspaceIndex));

// Rename — prepare confirms the cursor is on a renameable symbol; the rename request emits edits.
connection.onPrepareRename(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return prepareRename(params, document, workspaceIndex);
});

connection.onRenameRequest(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getRenameEdits(params, document, workspaceIndex);
});

// Code actions — quick-fix dispatch on diagnostic codes.
connection.onCodeAction(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getCodeActions(params, document, workspaceIndex);
});

// Signature help — show parameter docs inside `string(...)`, `int(...)`, etc.
connection.onSignatureHelp(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getSignatureHelp(params, document);
});

// Inlay hints — show inherited fields next to the model declaration.
connection.languages.inlayHint.on(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const parsed = documentManager.getDocument(params.textDocument.uri);
    if (!parsed) return [];
    return getInlayHints(params, parsed, workspaceIndex, document.getText());
});

// Semantic tokens — precise highlighting of types, modifiers, and identifiers.
connection.languages.semanticTokens.on(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };
    return getSemanticTokens(params, document, workspaceIndex);
});

documents.listen(connection);
connection.listen();
