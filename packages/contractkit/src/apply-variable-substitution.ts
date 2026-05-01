/**
 * Normalization pass — substitutes `{{name}}` references in every string-bearing field
 * of the AST with values from `root.meta` (the file's `options { keys }` block) or, when
 * absent, from a workspace-wide `fallbackKeys` map (typically merged from each plugin's
 * `options.keys` in `contractkit.config.json`).
 *
 * Runs in the CLI between `parseCk` and `decomposeCk`, after `applyOptionsDefaults`. It
 * deliberately does NOT run inside `parseCk` so the prettier plugin sees the un-substituted
 * source form and can round-trip the file.
 *
 * Substitution rules:
 *   - `{{name}}`  → value lookup; warns and emits the literal string `undefined` when missing.
 *   - `\{{name}}` → literal `{{name}}` (no substitution, no warning).
 *
 * `root.meta` is itself excluded from the walk — keys are not recursively substituted.
 */
import type { CkRootNode, OpRootNode, SourceLocation } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

const SUBSTITUTION_RE = /\\\{\{(\w+)\}\}|\{\{(\w+)\}\}/g;

type Root = CkRootNode | OpRootNode;

export function applyVariableSubstitution(root: Root, diag: DiagnosticCollector, fallbackKeys: Record<string, string> = {}): void {
    const file = root.file;
    const meta = root.meta ?? {};

    const lookup = (name: string): string | undefined => {
        if (Object.prototype.hasOwnProperty.call(meta, name)) return meta[name];
        if (Object.prototype.hasOwnProperty.call(fallbackKeys, name)) return fallbackKeys[name];
        return undefined;
    };

    const substitute = (input: string, line: number): string => {
        if (!input.includes('{{')) return input;
        return input.replace(SUBSTITUTION_RE, (_match, escapedName: string | undefined, varName: string | undefined) => {
            if (escapedName !== undefined) return `{{${escapedName}}}`;
            const value = lookup(varName!);
            if (value === undefined) {
                diag.warn(file, line, `Unknown variable '{{${varName}}}'`);
                return 'undefined';
            }
            return value;
        });
    };

    walk(root, substitute, 0, /* isRoot */ true);
}

function isLoc(value: unknown): value is SourceLocation {
    return typeof value === 'object' && value !== null && typeof (value as SourceLocation).line === 'number' && typeof (value as SourceLocation).file === 'string';
}

function walk(node: unknown, substitute: (s: string, line: number) => string, currentLine: number, isRoot: boolean): void {
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
        for (const item of node) walk(item, substitute, currentLine, false);
        return;
    }

    const obj = node as Record<string, unknown>;

    // Promote `loc.line` to the running context so warnings emitted while walking
    // this node's descendants can attribute themselves accurately.
    const ownLoc = obj['loc'];
    const lineHere = isLoc(ownLoc) ? ownLoc.line : currentLine;

    for (const key of Object.keys(obj)) {
        // Skip book-keeping fields and the substitution source itself.
        if (key === 'loc' || key === 'file') continue;
        if (isRoot && key === 'meta') continue;

        const value = obj[key];
        if (typeof value === 'string') {
            obj[key] = substitute(value, lineHere);
        } else if (value !== null && typeof value === 'object') {
            walk(value, substitute, lineHere, false);
        }
    }
}
