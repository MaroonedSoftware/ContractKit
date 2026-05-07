import { resolve, join, relative, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, rmdirSync } from 'node:fs';
import type {
    ContractKitPlugin,
    PluginContext,
    ContractRootNode,
    OpRootNode,
    ModelNode,
    IncrementalManifest,
    IncrementalUnit,
} from '@contractkit/core';
import {
    runIncrementalCodegen,
    parseIncrementalManifest,
    emptyIncrementalManifest,
    serializeIncrementalManifest,
    hashFingerprint,
    collectTransitiveModelRefs,
    collectTypeRefs,
} from '@contractkit/core';
import { generatePydanticModels, deriveModelsModuleName } from './codegen-models.js';
import {
    generatePythonClient,
    deriveClientClassName,
    deriveClientModuleName,
    deriveClientPropertyName,
    hasPublicOperations,
    BASE_CLIENT_PY,
} from './codegen-client.js';

export interface PythonSdkPluginConfig {
    /** Output directory relative to rootDir (default: "python-sdk") */
    baseDir?: string;
    /** Python package name used in the aggregator class name (default: "Sdk") */
    packageName?: string;
    /**
     * Whether to emit client methods for operations marked `internal`. Defaults to `false` —
     * internal ops are omitted so consumers don't pick them up. Set to `true` for an
     * internal-use SDK that should expose them.
     */
    includeInternal?: boolean;
}

/**
 * Bumped when the Python codegen output shape changes in a way that should
 * invalidate every per-file fingerprint. Mixed into the manifest's
 * `codegenVersion`, so a plugin upgrade forces full regeneration even when no
 * `.ck` files have changed.
 */
export const PYTHON_CODEGEN_VERSION = '1';

/** Filename for the persisted Python manifest under the CLI cache directory. */
const CACHE_MANIFEST_FILENAME = 'python-manifest.json';

const plugin: ContractKitPlugin = {
    name: 'python-sdk',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as PythonSdkPluginConfig;
        await runPythonCodegen(inputs, ctx, config, ctx.rootDir);
    },
};

export default plugin;

export function createPythonSdkPlugin(config: PythonSdkPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'python-sdk',
        async generateTargets(inputs, ctx) {
            await runPythonCodegen(inputs, ctx, config, rootDir);
        },
    };
}

/**
 * Shared orchestration. Builds per-file fingerprints, reuses unchanged outputs from
 * the manifest, regenerates only the affected client/model files, and rewrites the
 * shared aggregator + base files (cheap, depend only on the set of public clients).
 *
 * Honors `ctx.cacheEnabled` so `--force` bypasses the per-file cache.
 */
async function runPythonCodegen(
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    ctx: PluginContext,
    config: PythonSdkPluginConfig,
    rootDir: string,
): Promise<void> {
    const { contractRoots, opRoots } = inputs;
    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const outDir = resolve(rootDir, config.baseDir ?? 'python-sdk');
    const manifestPath = resolve(ctx.cacheDir, CACHE_MANIFEST_FILENAME);

    // ── Build cross-file lookup tables ───────────────────────────────────────
    const modelModulePaths = new Map<string, string>();
    const modelMap = new Map<string, ModelNode>();
    const contractEntries: { moduleName: string; relPath: string; root: ContractRootNode }[] = [];

    for (const root of contractRoots) {
        const moduleName = deriveModelsModuleName(root.file);
        contractEntries.push({ moduleName, relPath: `${moduleName}.py`, root });
        for (const model of root.models) {
            modelMap.set(model.name, model);
            modelModulePaths.set(model.name, `.${moduleName}`);
            if (modelsWithInput.has(model.name)) {
                modelModulePaths.set(`${model.name}Input`, `.${moduleName}`);
            }
        }
    }

    // Stable, sorted view of modelsWithInput for fingerprint slicing — only the
    // intersection with each unit's referenced names ends up in its fingerprint.
    const modelsWithInputArray = [...modelsWithInput].sort();

    const prevManifest: IncrementalManifest = ctx.cacheEnabled ? readManifest(manifestPath) : emptyIncrementalManifest(PYTHON_CODEGEN_VERSION);
    const units: IncrementalUnit[] = [];

    // ── Per-contract-root model files ────────────────────────────────────────
    for (const { moduleName, relPath, root } of contractEntries) {
        const ownNames = new Set(root.models.map(m => m.name));
        const externalRefs = collectExternalRefsFromContract(root, ownNames);
        // Module paths that this file actually imports — excludes self-refs and any
        // cross-file refs not used by this file's models.
        const referencedModulePaths: Record<string, string> = {};
        for (const ref of [...externalRefs].sort()) {
            const path = modelModulePaths.get(ref);
            if (path) referencedModulePaths[ref] = path;
            const inputPath = modelModulePaths.get(`${ref}Input`);
            if (inputPath) referencedModulePaths[`${ref}Input`] = inputPath;
        }
        const relevantInputModels = modelsWithInputArray.filter(name => ownNames.has(name) || externalRefs.has(name));

        const fingerprint = hashFingerprint({
            kind: 'models',
            v: PYTHON_CODEGEN_VERSION,
            relPath,
            currentModule: `.${moduleName}`,
            root,
            referencedModulePaths,
            modelsWithInput: relevantInputModels,
        });

        units.push({
            key: `models::${relPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: relPath,
                    content: generatePydanticModels(root, {
                        modelModulePaths,
                        currentModule: `.${moduleName}`,
                        modelsWithInput,
                    }),
                },
            ],
        });
    }

    // ── Per-op-root client files ─────────────────────────────────────────────
    const clientInfos: { moduleName: string; className: string; propertyName: string }[] = [];

    for (const root of opRoots) {
        if (!hasPublicOperations(root, config.includeInternal)) continue;
        const moduleName = deriveClientModuleName(root.file);
        const relPath = `${moduleName}.py`;
        clientInfos.push({
            moduleName,
            className: deriveClientClassName(root.file),
            propertyName: deriveClientPropertyName(root.file),
        });

        const referencedModels = collectOpRootModelRefs(root, modelMap);
        const referencedModulePaths: Record<string, string> = {};
        for (const ref of [...referencedModels].sort()) {
            const path = modelModulePaths.get(ref);
            if (path) referencedModulePaths[ref] = path;
            const inputPath = modelModulePaths.get(`${ref}Input`);
            if (inputPath) referencedModulePaths[`${ref}Input`] = inputPath;
        }
        const relevantInputModels = modelsWithInputArray.filter(name => referencedModels.has(name));

        const fingerprint = hashFingerprint({
            kind: 'client',
            v: PYTHON_CODEGEN_VERSION,
            relPath,
            currentModule: `.${moduleName}`,
            root,
            referencedModulePaths,
            modelsWithInput: relevantInputModels,
            includeInternal: config.includeInternal ?? false,
        });

        units.push({
            key: `client::${relPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: relPath,
                    content: generatePythonClient(root, {
                        modelModulePaths,
                        currentModule: `.${moduleName}`,
                        modelsWithInput,
                        includeInternal: config.includeInternal,
                    }),
                },
            ],
        });
    }

    // ── Global files: base client, requirements, aggregator ──────────────────
    // The aggregator (__init__.py) depends on the public-clients list. Writing it
    // every run is cheap (a few imports + a class body), so we skip a separate
    // unit for it. base_client.py and requirements.txt are constants.
    const sdkClassName = config.packageName
        ? config.packageName
              .split(/[-._\s]+/)
              .map(s => s.charAt(0).toUpperCase() + s.slice(1))
              .join('') + 'Sdk'
        : 'Sdk';

    const initLines: string[] = [
        '# Auto-generated by contractkit-plugin-python-sdk. Do not edit manually.',
        'from ._base_client import BaseClient, SdkError',
    ];
    for (const c of clientInfos) {
        initLines.push(`from .${c.moduleName} import ${c.className}`);
    }
    initLines.push('');
    initLines.push('');
    if (clientInfos.length > 0) {
        initLines.push(`class ${sdkClassName}(BaseClient):`);
        initLines.push(`    def __init__(self, base_url: str, headers: dict[str, str] | None = None):`);
        initLines.push(`        super().__init__(base_url, headers)`);
        for (const c of clientInfos) {
            initLines.push(`        self.${c.propertyName} = ${c.className}(base_url, headers)`);
        }
        initLines.push('');
    } else {
        initLines.push(`class ${sdkClassName}(BaseClient):`);
        initLines.push(`    pass`);
        initLines.push('');
    }
    const allNames = ['BaseClient', 'SdkError', sdkClassName, ...clientInfos.map(c => c.className)];
    initLines.push(`__all__ = [${allNames.map(n => JSON.stringify(n)).join(', ')}]`);
    initLines.push('');

    const globalFiles = [
        { relativePath: '_base_client.py', content: BASE_CLIENT_PY },
        { relativePath: 'requirements.txt', content: 'httpx\npydantic>=2.0\n' },
        { relativePath: '__init__.py', content: initLines.join('\n') },
    ];

    const result = runIncrementalCodegen({
        codegenVersion: PYTHON_CODEGEN_VERSION,
        prevManifest,
        globalFiles,
        units,
        fileExists: relPath => existsSync(resolve(outDir, relPath)),
    });

    deleteStalePaths(outDir, result.deletedPaths);

    for (const { relativePath, content } of result.filesToWrite) {
        ctx.emitFile(resolve(outDir, relativePath), content);
    }

    writeManifest(manifestPath, result.manifest);
    // Suppress unused import warning — `relative` is reserved for future use.
    void relative;
}

/** Collect every model name referenced by the contract root that isn't defined within it. */
function collectExternalRefsFromContract(root: ContractRootNode, ownNames: Set<string>): Set<string> {
    const refs = new Set<string>();
    for (const m of root.models) {
        if (m.type) collectTypeRefs(m.type, refs);
        for (const f of m.fields) collectTypeRefs(f.type, refs);
        if (m.bases) {
            for (const b of m.bases) refs.add(b);
        }
    }
    for (const own of ownNames) refs.delete(own);
    return refs;
}

/** Collect every model name referenced (transitively) by an op root. */
function collectOpRootModelRefs(root: OpRootNode, modelMap: Map<string, ModelNode>): Set<string> {
    const seeds = [];
    for (const route of root.routes) {
        if (route.params) seeds.push(...paramSourceTypes(route.params));
        for (const op of route.operations) {
            if (op.query) seeds.push(...paramSourceTypes(op.query));
            if (op.headers) seeds.push(...paramSourceTypes(op.headers));
            if (op.request) {
                for (const body of op.request.bodies) seeds.push(body.bodyType);
            }
            for (const resp of op.responses) {
                if (resp.bodyType) seeds.push(resp.bodyType);
                if (resp.headers) {
                    for (const h of resp.headers) seeds.push(h.type);
                }
            }
        }
    }
    return collectTransitiveModelRefs(seeds, modelMap);
}

function paramSourceTypes(src: NonNullable<OpRootNode['routes'][number]['params']>): Parameters<typeof collectTypeRefs>[0][] {
    const out: Parameters<typeof collectTypeRefs>[0][] = [];
    if (src.kind === 'params') {
        for (const n of src.nodes) out.push(n.type);
    } else if (src.kind === 'ref') {
        out.push({ kind: 'ref', name: src.name } as Parameters<typeof collectTypeRefs>[0]);
    } else if (src.kind === 'type') {
        out.push(src.node);
    }
    return out;
}

/** Read the previous run's manifest from `manifestPath`. Returns an empty manifest when missing or unreadable. */
function readManifest(manifestPath: string): IncrementalManifest {
    if (!existsSync(manifestPath)) return emptyIncrementalManifest(PYTHON_CODEGEN_VERSION);
    try {
        return parseIncrementalManifest(readFileSync(manifestPath, 'utf-8'));
    } catch {
        return emptyIncrementalManifest(PYTHON_CODEGEN_VERSION);
    }
}

/** Write the manifest to `manifestPath`. Creates parent dirs as needed. Errors are swallowed so a broken cache never blocks the build. */
function writeManifest(manifestPath: string, manifest: IncrementalManifest): void {
    try {
        mkdirSync(dirname(manifestPath), { recursive: true });
        writeFileSync(manifestPath, serializeIncrementalManifest(manifest), 'utf-8');
    } catch {
        // best-effort
    }
}

/** Delete paths from the prior manifest that aren't produced this run. Mirrors the Bruno cleanup approach. */
function deleteStalePaths(outDir: string, relPaths: string[]): void {
    if (relPaths.length === 0) return;
    const removedDirs = new Set<string>();
    for (const rel of relPaths) {
        const abs = resolve(outDir, rel);
        if (existsSync(abs)) {
            rmSync(abs, { force: true });
            removedDirs.add(join(abs, '..'));
        }
    }
    for (const dir of removedDirs) {
        let current = dir;
        while (current.startsWith(outDir) && current !== outDir) {
            try {
                if (readdirSync(current).length === 0) {
                    rmdirSync(current);
                    current = join(current, '..');
                } else {
                    break;
                }
            } catch {
                break;
            }
        }
    }
}
