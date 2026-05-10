import { DocumentLink, DocumentLinkParams, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';
import type { ParsedDocument } from './document-manager.js';

const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"/g;

export function getDocumentLinks(params: DocumentLinkParams, document: TextDocument, parsed?: ParsedDocument): DocumentLink[] {
    const text = document.getText();
    const links: DocumentLink[] = [];

    let docDir: string | null;
    try {
        docDir = path.dirname(fileURLToPath(params.textDocument.uri));
    } catch {
        docDir = null;
    }

    const meta = parsed?.ast.meta ?? {};

    for (const match of text.matchAll(STRING_LITERAL)) {
        const raw = match[1]!;
        const expanded = expandVariables(raw, meta);
        // If any placeholder is still unresolved, skip — a half-substituted URL won't open anyway.
        if (expanded === null) continue;
        const target = resolveTarget(expanded, docDir);
        if (!target) continue;

        // The string literal includes the quotes; the link should target the contents only.
        const startOffset = (match.index ?? 0) + 1;
        const endOffset = startOffset + raw.length;
        links.push({
            range: Range.create(document.positionAt(startOffset), document.positionAt(endOffset)),
            target,
        });
    }

    return links;
}

/** Expand `{{name}}` placeholders against the file's `options { keys }` map. Returns null if any
 * placeholder cannot be resolved — the caller skips the link entirely rather than emit a broken URL. */
function expandVariables(value: string, meta: Record<string, string>): string | null {
    if (!value.includes('{{')) return value;
    let unresolved = false;
    const out = value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const v = meta[name];
        if (v === undefined) {
            unresolved = true;
            return '';
        }
        return v;
    });
    return unresolved ? null : out;
}

function resolveTarget(value: string, docDir: string | null): string | undefined {
    if (/^https?:\/\//i.test(value)) return value;
    if (/^file:\/\//i.test(value)) {
        // Normalize file URLs through pathToFileURL so any `./` or `..` segments collapse and the
        // OS-level open call gets a canonical path.
        try {
            const fsPath = fileURLToPath(value);
            return pathToFileURL(path.resolve(fsPath)).toString();
        } catch {
            return value;
        }
    }
    if (value.startsWith('./') || value.startsWith('../')) {
        if (!docDir) return undefined;
        return pathToFileURL(path.resolve(docDir, value)).toString();
    }
    return undefined;
}
