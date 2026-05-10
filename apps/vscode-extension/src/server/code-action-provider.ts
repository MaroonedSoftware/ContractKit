import { CodeAction, CodeActionKind, CodeActionParams, Diagnostic, Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { WorkspaceIndex } from './workspace-index.js';

export function getCodeActions(params: CodeActionParams, document: TextDocument, index: WorkspaceIndex): CodeAction[] {
    const actions: CodeAction[] = [];
    for (const diag of params.context.diagnostics) {
        const code = typeof diag.code === 'string' ? diag.code : undefined;
        if (!code) continue;
        switch (code) {
            case 'missing-override':
                actions.push(...buildAddOverrideAction(diag, document));
                break;
            case 'spurious-override':
                actions.push(...buildRemoveOverrideAction(diag, document));
                break;
            case 'unknown-model':
                actions.push(...buildSuggestModelActions(diag, document, index));
                break;
        }
    }
    return actions;
}

function buildAddOverrideAction(diag: Diagnostic, document: TextDocument): CodeAction[] {
    const lineNum = diag.range.start.line;
    const lines = document.getText().split('\n');
    const lineText = lines[lineNum];
    if (!lineText) return [];

    const indentMatch = /^(\s*)/.exec(lineText);
    const indent = indentMatch?.[1] ?? '';
    const afterIndent = lineText.slice(indent.length);

    // The diagnostic message embeds the field name as `Field 'X' ...` — extract it.
    const nameMatch = /Field '([A-Za-z_][A-Za-z0-9_]*)'/.exec(diag.message);
    if (!nameMatch) return [];
    const fieldName = nameMatch[1]!;

    // Don't add `override` if it's already there.
    if (/(^|\s)override(\s|$)/.test(afterIndent)) return [];

    // Insert `override ` before the field name. Tokens that may precede:
    // none, `deprecated`, `readonly`, `writeonly`, or other modifiers.
    // Strategy: insert `override ` immediately after the leading whitespace.
    const edit = TextEdit.insert({ line: lineNum, character: indent.length }, 'override ');
    const change: WorkspaceEdit = { changes: { [document.uri]: [edit] } };
    return [
        {
            title: `Add 'override' to '${fieldName}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            isPreferred: true,
            edit: change,
        },
    ];
}

function buildRemoveOverrideAction(diag: Diagnostic, document: TextDocument): CodeAction[] {
    const lineNum = diag.range.start.line;
    const lines = document.getText().split('\n');
    const lineText = lines[lineNum];
    if (!lineText) return [];

    const re = /\boverride\s+/;
    const m = re.exec(lineText);
    if (!m) return [];
    const start = m.index;
    const end = start + m[0]!.length;
    const edit = TextEdit.replace(Range.create(lineNum, start, lineNum, end), '');
    return [
        {
            title: "Remove 'override'",
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            isPreferred: true,
            edit: { changes: { [document.uri]: [edit] } },
        },
    ];
}

function buildSuggestModelActions(diag: Diagnostic, document: TextDocument, index: WorkspaceIndex): CodeAction[] {
    const nameMatch = /"([A-Za-z_][A-Za-z0-9_]*)"/.exec(diag.message);
    if (!nameMatch) return [];
    const unknown = nameMatch[1]!;

    const candidates = closestModelNames(unknown, index.getAllModelNames(), 3);
    return candidates.map(suggestion => {
        const lineNum = diag.range.start.line;
        const lines = document.getText().split('\n');
        const lineText = lines[lineNum] ?? '';
        const idx = findIdentifierIndex(lineText, unknown);
        if (idx < 0) {
            return null;
        }
        const edit = TextEdit.replace(Range.create(lineNum, idx, lineNum, idx + unknown.length), suggestion);
        return {
            title: `Replace '${unknown}' with '${suggestion}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            edit: { changes: { [document.uri]: [edit] } },
        } as CodeAction;
    }).filter((a): a is CodeAction => a !== null);
}

function findIdentifierIndex(line: string, name: string): number {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = re.exec(line);
    return m ? m.index : -1;
}

/** Return up to `count` names from `pool` ranked by Levenshtein distance to `target`, closest first. */
function closestModelNames(target: string, pool: string[], count: number): string[] {
    return pool
        .map(name => ({ name, dist: levenshtein(target.toLowerCase(), name.toLowerCase()) }))
        .filter(x => x.dist > 0 && x.dist <= Math.max(2, Math.floor(target.length / 3)))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, count)
        .map(x => x.name);
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = new Array<number>(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        let curr = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const next = Math.min(curr + 1, prev[j]! + 1, prev[j - 1]! + cost);
            prev[j - 1] = curr;
            curr = next;
        }
        prev[b.length] = curr;
    }
    return prev[b.length]!;
}
