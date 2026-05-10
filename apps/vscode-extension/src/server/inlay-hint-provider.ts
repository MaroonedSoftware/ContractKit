import { InlayHint, InlayHintKind, InlayHintParams, Position } from 'vscode-languageserver';
import type { ModelNode } from '@contractkit/core';
import type { ParsedDocument } from './document-manager.js';
import type { WorkspaceIndex } from './workspace-index.js';

const MAX_FILE_SIZE = 200_000; // bytes — bail on very large files to avoid render-loop costs

export function getInlayHints(_params: InlayHintParams, parsed: ParsedDocument, index: WorkspaceIndex, sourceText: string): InlayHint[] {
    if (sourceText.length > MAX_FILE_SIZE) return [];

    const lines = sourceText.split('\n');
    const hints: InlayHint[] = [];

    const modelMap = new Map<string, ModelNode>();
    for (const name of index.getAllModelNames()) {
        const entry = index.getModel(name);
        if (entry) modelMap.set(name, entry.model);
    }

    for (const model of parsed.ast.models) {
        if (!model.bases || model.bases.length === 0) continue;
        const inherited = collectInheritedFieldNames(model, modelMap);
        if (inherited.size === 0) continue;
        const ownFields = new Set(model.fields.map(f => f.name));
        const newlyInherited = [...inherited].filter(name => !ownFields.has(name));
        if (newlyInherited.length === 0) continue;

        const declLineIdx = Math.max(0, model.loc.line - 1);
        const declLine = lines[declLineIdx] ?? '';
        const braceIdx = declLine.indexOf('{');
        const character = braceIdx >= 0 ? braceIdx : declLine.length;

        const label = `+ ${newlyInherited.slice(0, 6).join(', ')}${newlyInherited.length > 6 ? `, +${newlyInherited.length - 6} more` : ''}`;
        hints.push({
            position: Position.create(declLineIdx, character),
            label,
            kind: InlayHintKind.Type,
            paddingLeft: true,
            paddingRight: true,
        });
    }

    return hints;
}

/** Recursively gather the field names contributed by a model's base chain. Cycles are tolerated via a visited set. */
function collectInheritedFieldNames(model: ModelNode, modelMap: Map<string, ModelNode>): Set<string> {
    const visited = new Set<string>();
    const out = new Set<string>();
    const queue = [...(model.bases ?? [])];
    while (queue.length > 0) {
        const baseName = queue.shift()!;
        if (visited.has(baseName)) continue;
        visited.add(baseName);
        const base = modelMap.get(baseName);
        if (!base) continue;
        for (const f of base.fields) out.add(f.name);
        if (base.bases) queue.push(...base.bases);
    }
    return out;
}
