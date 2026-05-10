import { DocumentLink, DocumentLinkParams, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';

const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"/g;

export function getDocumentLinks(params: DocumentLinkParams, document: TextDocument): DocumentLink[] {
    const text = document.getText();
    const links: DocumentLink[] = [];

    let docDir: string | null;
    try {
        docDir = path.dirname(fileURLToPath(params.textDocument.uri));
    } catch {
        docDir = null;
    }

    for (const match of text.matchAll(STRING_LITERAL)) {
        const raw = match[1]!;
        const target = resolveTarget(raw, docDir);
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

function resolveTarget(value: string, docDir: string | null): string | undefined {
    if (/^https?:\/\//i.test(value)) return value;
    if (/^file:\/\//i.test(value)) return value;
    if (value.startsWith('./') || value.startsWith('../')) {
        if (!docDir) return undefined;
        return pathToFileURL(path.resolve(docDir, value)).toString();
    }
    return undefined;
}
