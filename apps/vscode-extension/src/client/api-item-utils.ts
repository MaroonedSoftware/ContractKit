import { operationId } from '@contractkit/explorer-ui';
import type { ItemSelection, PreviewData, ResolvedOperation } from '@contractkit/explorer-ui';

/**
 * Resolves an `ItemSelection` back to its source location (file + 1-based line) by matching the
 * selection's id against the entries in `data`. Returns `undefined` when the item isn't in the
 * snapshot or when the selection is the synthetic `overview` page.
 */
export function locateItem(data: PreviewData, selection: ItemSelection): { file: string; line: number } | undefined {
    if (selection.kind === 'operation') {
        const op = data.operations.find(o => operationId(o) === selection.id);
        if (!op) return undefined;
        return { file: op.filePath, line: op.op.loc.line };
    }
    if (selection.kind === 'model') {
        const m = data.models.find(m => m.model.name === selection.name);
        if (!m) return undefined;
        return { file: m.filePath, line: m.model.loc.line };
    }
    return undefined;
}

/**
 * Builds a placeholder cURL command for an operation. Path parameters are rendered as `${name}`
 * shell-style placeholders so the user can paste the result and substitute values. Declared
 * headers become `-H 'Name: <Name>'` placeholders. JSON request bodies pre-populate `--data '{}'`.
 */
export function buildCurl(op: ResolvedOperation, baseUrl: string): string {
    const path = op.routePath.replace(/\{([^}]+)\}/g, (_m, name: string) => `\${${name}}`);
    const url = `${stripTrailingSlash(baseUrl)}${path}`;
    const parts = [`curl -X ${op.method.toUpperCase()}`, `'${url}'`];

    if (op.op.headers?.kind === 'params') {
        for (const h of op.op.headers.nodes) parts.push(`-H '${h.name}: <${h.name}>'`);
    }

    const jsonBody = op.op.request?.bodies.find(
        b => b.contentType === 'application/json' || b.contentType.endsWith('+json'),
    );
    if (jsonBody) {
        parts.push(`-H 'Content-Type: application/json'`);
        parts.push(`--data '{}'`);
    }

    return parts.join(' \\\n    ');
}

function stripTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}
