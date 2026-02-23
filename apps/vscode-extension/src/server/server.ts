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

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const documentManager = new DocumentManager(connection);
const workspaceIndex = new WorkspaceIndex();

connection.onInitialize((params: InitializeParams): InitializeResult => {
    // Index workspace folders on startup
    const folders = params.workspaceFolders;
    if (folders) {
        const paths = folders.map((f) => fileURLToPath(f.uri));
        workspaceIndex.indexWorkspace(paths).catch(() => {
            // Silent failure on initial indexing
        });
    }

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            completionProvider: {
                triggerCharacters: [':', '/', '(', ',', '|', ' '],
            },
            hoverProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
        },
    };
});

// Reparse and push diagnostics on document change
documents.onDidChangeContent((change) => {
    documentManager.scheduleReparse(change.document);
    // Also update workspace index with latest source
    workspaceIndex.indexFromSource(change.document.uri, change.document.getText());
});

// Clean up on document close
documents.onDidClose((event) => {
    documentManager.removeDocument(event.document.uri);
});

// Watch for file system changes (saves, creates, deletes of .dto/.op files)
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
connection.onDocumentSymbol((params) => {
    const parsed = documentManager.getDocument(params.textDocument.uri);
    if (!parsed) return [];
    return getDocumentSymbols(parsed);
});

// Go to definition
connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getDefinition(params, document, workspaceIndex);
});

// Hover
connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getHover(params, document, workspaceIndex);
});

// Auto-completion
connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getCompletions(params, document, workspaceIndex);
});

documents.listen(connection);
connection.listen();
