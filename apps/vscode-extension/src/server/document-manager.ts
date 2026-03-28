import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath } from 'node:url';
import { Connection, Diagnostic as LspDiagnostic } from 'vscode-languageserver';
import { parseDto, parseOp, validateOp, DiagnosticCollector } from '@maroonedsoftware/contractkit';
import type { DtoRootNode, OpRootNode } from '@maroonedsoftware/contractkit';
import { toLspDiagnostics } from './diagnostics-adapter.js';

export type ParsedDocument = { kind: 'dto'; ast: DtoRootNode; version: number } | { kind: 'op'; ast: OpRootNode; version: number };

export class DocumentManager {
  private cache = new Map<string, ParsedDocument>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private connection: Connection) {}

  getDocument(uri: string): ParsedDocument | undefined {
    return this.cache.get(uri);
  }

  getAllDocuments(): Map<string, ParsedDocument> {
    return this.cache;
  }

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

  parseAndPublish(document: TextDocument): void {
    const uri = document.uri;
    const text = document.getText();
    const diag = new DiagnosticCollector();
    const filePath = uriToFilePath(uri);
    const isDtoFile = uri.endsWith('.dto');

    try {
      if (isDtoFile) {
        const ast = parseDto(text, filePath, diag);
        this.cache.set(uri, { kind: 'dto', ast, version: document.version });
      } else {
        const ast = parseOp(text, filePath, diag);
        validateOp(ast, diag);
        this.cache.set(uri, { kind: 'op', ast, version: document.version });
      }
    } catch {
      // If parsing crashes entirely, still report collected diagnostics
    }

    const lspDiagnostics: LspDiagnostic[] = toLspDiagnostics(diag.getAll());
    this.connection.sendDiagnostics({ uri, diagnostics: lspDiagnostics });
  }

  removeDocument(uri: string): void {
    this.cache.delete(uri);
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
