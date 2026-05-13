import * as path from 'node:path';
import {
    DiagnosticCollector,
    applyOptionsDefaults,
    applyVariableSubstitution,
    decomposeCk,
    resolveModifiers,
    resolveSecurity,
} from '@contractkit/core';
import type { CkRootNode } from '@contractkit/core';
import type {
    PreviewData,
    PreviewConfigMeta,
    PreviewWarning,
    ResolvedModel,
    ResolvedOperation,
} from '@contractkit/explorer-ui';
import type { WorkspaceIndex } from './workspace-index.js';
import type { WorkspaceConfigCache } from './workspace-config.js';

/**
 * Builds a fully-resolved PreviewData snapshot from the workspace index.
 * Best-effort: parse errors and validation issues become warnings, never throw.
 */
export function buildPreviewData(
    workspaceIndex: WorkspaceIndex,
    configCache: WorkspaceConfigCache,
    workspaceRoot?: string,
): PreviewData {
    const entries = workspaceIndex.getAllAsts();
    if (entries.length === 0) {
        return {
            configMeta: { title: 'ContractKit API', version: '0.0.0' },
            workspaceRoot,
            operations: [],
            models: [],
            warnings: [],
        };
    }

    const diag = new DiagnosticCollector();
    const operations: ResolvedOperation[] = [];
    const models: ResolvedModel[] = [];
    let configMeta: PreviewConfigMeta | undefined;

    const sorted = [...entries].sort((a, b) => a.filePath.localeCompare(b.filePath));

    for (const { filePath, ast } of sorted) {
        let cloned: CkRootNode;
        try {
            cloned = structuredClone(ast);
        } catch (err) {
            diag.warn(filePath, 0, `Failed to clone AST: ${(err as Error).message}`);
            continue;
        }

        try {
            applyOptionsDefaults(cloned, diag);
            applyVariableSubstitution(cloned, diag, configCache.getKeysForFile(filePath));
        } catch (err) {
            diag.warn(filePath, 0, `Normalization failed: ${(err as Error).message}`);
            continue;
        }

        let contractRoot: ReturnType<typeof decomposeCk>['contract'];
        let opRoot: ReturnType<typeof decomposeCk>['op'];
        try {
            const decomposed = decomposeCk(cloned);
            contractRoot = decomposed.contract;
            opRoot = decomposed.op;
        } catch (err) {
            diag.warn(filePath, 0, `Decompose failed: ${(err as Error).message}`);
            continue;
        }

        const fileGroup = cloned.meta?.area ?? toRelativePath(filePath, workspaceRoot);

        if (!configMeta && (cloned.meta?.title || cloned.meta?.version)) {
            configMeta = {
                title: cloned.meta.title ?? 'ContractKit API',
                version: cloned.meta.version ?? '0.0.0',
                description: cloned.meta.description,
            };
        }

        for (const model of contractRoot.models) {
            models.push({ filePath, model });
        }

        for (const route of opRoot.routes) {
            for (const op of route.operations) {
                operations.push({
                    filePath,
                    fileGroup,
                    routePath: route.path,
                    method: op.method,
                    op,
                    routeParams: route.params,
                    effectiveModifiers: resolveModifiers(route, op),
                    effectiveSecurity: resolveSecurity(route, op, opRoot),
                });
            }
        }
    }

    return jsonSafe({
        configMeta: configMeta ?? { title: 'ContractKit API', version: '0.0.0' },
        workspaceRoot,
        operations,
        models,
        warnings: dedupeWarnings(diag.getAll().map(d => ({ message: d.message, file: d.file, line: d.line }))),
    });
}

/**
 * Recursively converts BigInt primitives to their decimal string form so the response can pass
 * through the JSON-RPC transport. `bigint(min=…)` constraints on scalar types parse as native
 * BigInts in the AST; JSON.stringify throws on them.
 */
function jsonSafe<T>(value: T): T {
    if (typeof value === 'bigint') return value.toString() as unknown as T;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(jsonSafe) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = jsonSafe(v);
    }
    return out as T;
}

function toRelativePath(filePath: string, workspaceRoot: string | undefined): string {
    if (!workspaceRoot) return path.basename(filePath);
    const rel = path.relative(workspaceRoot, filePath);
    return rel === '' ? path.basename(filePath) : rel;
}

function dedupeWarnings(warnings: PreviewWarning[]): PreviewWarning[] {
    const seen = new Set<string>();
    const out: PreviewWarning[] = [];
    for (const w of warnings) {
        const key = `${w.file ?? ''}:${w.line ?? ''}:${w.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(w);
    }
    return out;
}
