import { Location, Range, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { WorkspaceIndex } from './workspace-index.js';
import type { WorkspaceConfigCache } from './workspace-config.js';
import type { ParsedDocument } from './document-manager.js';
import { getWordAtPosition, type WordAtPosition } from '../shared/word-at-position.js';
import { resolveServiceMethod } from './service-resolver.js';

/**
 * Resolve the definition Location for the identifier under the cursor, or `null`.
 *
 * Handles model refs and `service:` class refs (both jump within `.ck` files), plus a
 * `service: Class.method` cursor on the **method** segment, which resolves to the method in the
 * TypeScript service source. Method resolution needs `parsed` (for the file's `services` map) and
 * `configCache` (for the TS plugin's `server.baseDir`); without them it falls back to the other lookups.
 */
export function getDefinition(
    params: TextDocumentPositionParams,
    document: TextDocument,
    index: WorkspaceIndex,
    parsed?: ParsedDocument,
    configCache?: WorkspaceConfigCache,
): Location | null {
    const hit = getWordAtPosition(document, params.position.line, params.position.character);
    if (!hit) return null;
    const word = hit.word;

    // `service: Class.method` with the cursor on the method segment → jump to the TS source method.
    const lineText = document.getText().split('\n')[params.position.line] ?? '';
    const call = matchServiceMethodCall(lineText, hit);
    if (call && parsed && configCache) {
        const loc = resolveServiceMethodDefinition(params.textDocument.uri, call, parsed, configCache);
        if (loc) return loc;
        // Fall through: if the source can't be resolved, other lookups below still apply.
    }

    const modelEntry = index.getModel(word);
    if (modelEntry) {
        const line = Math.max(0, modelEntry.line - 1);
        return {
            uri: modelEntry.uri,
            range: Range.create(line, modelEntry.column, line, modelEntry.column + word.length),
        };
    }

    const serviceDecl = index.getServiceDecl(word);
    if (serviceDecl) {
        const line = Math.max(0, serviceDecl.line - 1);
        return {
            uri: serviceDecl.uri,
            range: Range.create(line, serviceDecl.column, line, serviceDecl.column + word.length),
        };
    }

    return null;
}

interface ServiceMethodCall {
    serviceName: string;
    methodName: string;
}

/** Detect `service: Class.method` on `lineText` with the cursor's word (`hit`) on the method segment. */
function matchServiceMethodCall(lineText: string, hit: WordAtPosition): ServiceMethodCall | null {
    const m = /\bservice\s*:\s*([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)/.exec(lineText);
    if (!m) return null;
    const serviceName = m[1]!;
    const methodName = m[2]!;
    const dotIndex = m.index + m[0].indexOf(serviceName) + serviceName.length;
    const methodStart = dotIndex + 1;
    if (hit.start !== methodStart || hit.word !== methodName) return null;
    return { serviceName, methodName };
}

/** Resolve a service-method call to its TS source location, or `null` when unresolvable. */
function resolveServiceMethodDefinition(
    docUri: string,
    call: ServiceMethodCall,
    parsed: ParsedDocument,
    configCache: WorkspaceConfigCache,
): Location | null {
    const moduleSpecifier = parsed.ast.services?.[call.serviceName];
    if (!moduleSpecifier) return null;

    let filePath: string;
    try {
        filePath = fileURLToPath(docUri);
    } catch {
        return null;
    }

    const serviceBaseDir = configCache.getServiceBaseDirForFile(filePath);
    if (!serviceBaseDir) return null;

    const pos = resolveServiceMethod(serviceBaseDir, moduleSpecifier, call.methodName);
    if (!pos) return null;

    return {
        uri: pathToFileURL(pos.filePath).toString(),
        range: Range.create(pos.line, pos.column, pos.line, pos.column + pos.length),
    };
}
