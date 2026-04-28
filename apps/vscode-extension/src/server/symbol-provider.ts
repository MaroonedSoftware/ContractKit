import { DocumentSymbol, SymbolKind, Range } from 'vscode-languageserver';
import type { ParsedDocument } from './document-manager.js';

export function getDocumentSymbols(parsed: ParsedDocument): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];

    // Contract (model) symbols
    for (const model of parsed.ast.models) {
        const modelLine = Math.max(0, model.loc.line - 1);
        const children: DocumentSymbol[] = model.fields.map(field => {
            const fieldLine = Math.max(0, field.loc.line - 1);
            return {
                name: field.name,
                kind: SymbolKind.Field,
                range: Range.create(fieldLine, 0, fieldLine, 200),
                selectionRange: Range.create(fieldLine, 0, fieldLine, field.name.length),
                detail: formatFieldType(field),
            };
        });
        symbols.push({
            name: model.name,
            kind: SymbolKind.Class,
            range: Range.create(modelLine, 0, modelLine + model.fields.length + 1, 0),
            selectionRange: Range.create(modelLine, 0, modelLine, model.name.length),
            detail: model.bases && model.bases.length > 0 ? `extends ${model.bases.join(', ')}` : undefined,
            children,
        });
    }

    // Operation (route) symbols
    for (const route of parsed.ast.routes) {
        const routeLine = Math.max(0, route.loc.line - 1);
        const children: DocumentSymbol[] = route.operations.map(op => {
            const opLine = Math.max(0, op.loc.line - 1);
            return {
                name: op.method.toUpperCase(),
                kind: SymbolKind.Method,
                range: Range.create(opLine, 0, opLine, 200),
                selectionRange: Range.create(opLine, 0, opLine, op.method.length),
                detail: op.service,
            };
        });
        symbols.push({
            name: route.path,
            kind: SymbolKind.Module,
            range: Range.create(routeLine, 0, routeLine + route.operations.length + 1, 0),
            selectionRange: Range.create(routeLine, 0, routeLine, route.path.length),
            children,
        });
    }

    return symbols;
}

function formatFieldType(field: { optional: boolean; type: { kind: string } }): string {
    let detail = field.type.kind;
    if (field.optional) detail = `${detail}?`;
    return detail;
}
