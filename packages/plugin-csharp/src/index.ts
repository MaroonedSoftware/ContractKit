import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import type {
    ContractKitPlugin,
    ContractRootNode,
    IncrementalManifest,
    IncrementalOutputFile,
    IncrementalUnit,
    ModelNode,
    PluginContext,
} from '@contractkit/core';
import {
    buildModelIndex,
    collectTypeRefs,
    emptyIncrementalManifest,
    hashFingerprint,
    parseIncrementalManifest,
    runIncrementalCodegen,
    serializeIncrementalManifest,
} from '@contractkit/core';
import { generateCSharpModels, resolveModelsWithInput } from './codegen-models.js';
import { generateSdkCs, type SdkAggregatorClient } from './codegen-sdk.js';
import { collectHoistedTypes } from './hoist.js';
import { generateRuntimeCs } from './runtime.js';
import { generateConvertersCs } from './runtime-converters.js';
import { generateCsproj } from './scaffold.js';
import { CSHARP_KEYWORDS, deriveCSharpFileBase } from './naming.js';

export interface CSharpSdkPluginConfig {
    /** Output directory relative to rootDir (default: "csharp-sdk") */
    baseDir?: string;
    /** Root namespace for the generated sources, e.g. "Acme.Sdk" (default: "ContractKit.Sdk") */
    namespace?: string;
    /** Aggregator class name (default: "Sdk"). Also the assembly name when scaffolding. */
    sdkName?: string;
    /**
     * Whether to emit client methods for operations marked `internal`. Defaults to `false` —
     * internal ops are omitted so consumers don't pick them up.
     */
    includeInternal?: boolean;
    /** Emit `<SdkName>.csproj` once, as a user-owned file. Never overwritten. */
    scaffold?: boolean;
}

/**
 * Bumped when the C# codegen output shape changes in a way that should invalidate every per-file
 * fingerprint, so a plugin upgrade forces full regeneration even when no `.ck` file has changed.
 */
export const CSHARP_CODEGEN_VERSION = '1';

const CACHE_MANIFEST_FILENAME = 'csharp-manifest.json';
const DEFAULT_BASE_DIR = 'csharp-sdk';
const DEFAULT_NAMESPACE = 'ContractKit.Sdk';
const DEFAULT_SDK_NAME = 'Sdk';

const plugin: ContractKitPlugin = {
    name: 'csharp-sdk',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as CSharpSdkPluginConfig;
        await runCSharpCodegen(inputs, ctx, config, ctx.rootDir);
    },
};

export default plugin;

export function createCSharpSdkPlugin(config: CSharpSdkPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'csharp-sdk',
        async generateTargets(inputs, ctx) {
            await runCSharpCodegen(inputs, ctx, config, rootDir);
        },
    };
}

const NAMESPACE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const SDK_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reject config that would generate C# which cannot compile. These are runtime checks, not just
 * types: config arrives as JSON, so the TypeScript interface constrains programmatic callers only.
 */
export function assertValidConfig(config: CSharpSdkPluginConfig): void {
    const { namespace, sdkName } = config;
    if (namespace !== undefined) {
        if (typeof namespace !== 'string' || !NAMESPACE_RE.test(namespace)) {
            throw new Error(
                `plugin-csharp: namespace '${String(namespace)}' is not a valid C# namespace — expected dot-separated identifiers, e.g. 'Acme.Sdk'.`,
            );
        }
        const keyword = namespace.split('.').find(segment => CSHARP_KEYWORDS.has(segment));
        if (keyword) {
            throw new Error(`plugin-csharp: namespace '${namespace}' contains the C# keyword '${keyword}', which cannot appear in a namespace.`);
        }
    }
    if (sdkName !== undefined) {
        if (typeof sdkName !== 'string' || !SDK_NAME_RE.test(sdkName)) {
            throw new Error(`plugin-csharp: sdkName '${String(sdkName)}' is not a valid C# class name.`);
        }
        if (CSHARP_KEYWORDS.has(sdkName)) {
            throw new Error(`plugin-csharp: sdkName '${sdkName}' is a C# keyword.`);
        }
    }
    for (const key of ['includeInternal', 'scaffold'] as const) {
        const value = config[key];
        if (value !== undefined && typeof value !== 'boolean') {
            throw new Error(`plugin-csharp: ${key} must be a boolean — got ${JSON.stringify(value)}.`);
        }
    }
}

/**
 * Shared orchestration. Builds per-file fingerprints, reuses unchanged outputs from the manifest,
 * regenerates only the affected files, and rewrites the shared runtime and aggregator every run
 * (they are cheap and depend only on the set of public clients).
 *
 * Honors `ctx.cacheEnabled`, so `--force` bypasses the per-file cache.
 */
async function runCSharpCodegen(
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    ctx: PluginContext,
    config: CSharpSdkPluginConfig,
    rootDir: string,
): Promise<void> {
    assertValidConfig(config);

    const { contractRoots } = inputs;
    const namespaceName = config.namespace ?? DEFAULT_NAMESPACE;
    const sdkName = config.sdkName ?? DEFAULT_SDK_NAME;
    const outDir = resolve(rootDir, config.baseDir ?? DEFAULT_BASE_DIR);
    const manifestPath = resolve(ctx.cacheDir, CACHE_MANIFEST_FILENAME);

    // Every model shares one C# namespace, so a cross-file reference resolves by name and the only
    // cross-file input a models unit has is which names carry an Input variant.
    const allModels: ModelNode[] = contractRoots.flatMap(root => root.models);
    const modelIndex = buildModelIndex(allModels);
    // Resolved once over every model, so the hoisting pass and each file's renderer agree on which
    // names carry an `Input` variant.
    const modelsWithInput = resolveModelsWithInput(allModels, inputs.modelsWithInput);
    const modelsWithInputArray = [...modelsWithInput].sort();

    // Names for the anonymous shapes — unions, inline objects, field-level enums, tuples — that C#
    // needs a declaration for. Computed across every file at once: a discriminated union declared in
    // one file makes member records generated in other files implement its interface.
    const hoisted = collectHoistedTypes(contractRoots, {
        modelIndex,
        modelsWithInput,
        warn: (message, file) => ctx.warn?.(message, file),
    });

    const prevManifest: IncrementalManifest = ctx.cacheEnabled ? readManifest(manifestPath) : emptyIncrementalManifest(CSHARP_CODEGEN_VERSION);
    const units: IncrementalUnit[] = [];
    const clients: SdkAggregatorClient[] = [];

    for (const root of contractRoots) {
        const relPath = `Models/${deriveCSharpFileBase(root.file)}.cs`;
        const ownNames = new Set(root.models.map(m => m.name));
        const referenced = referencedModelNames(root);
        const relevantInputModels = modelsWithInputArray.filter(name => ownNames.has(name) || referenced.has(name));
        // A base declared in another file contributes its fields to a record generated here, so the
        // fingerprint has to move when that base does.
        const externalBases = [...referenced]
            .filter(name => !ownNames.has(name))
            .sort()
            .map(name => modelIndex.get(name))
            .filter((m): m is ModelNode => m !== undefined);

        // Declarations this file owns, and the interfaces its records implement, are both decided by
        // the whole project, so they belong in the fingerprint alongside the file.
        const ownedDeclarations = (hoisted.byFile.get(root.file) ?? []).map(d => ({ kind: d.kind, name: d.name, needsInput: d.needsInput }));
        const declaredMemberships = [...ownNames]
            .sort()
            .map(name => [name, hoisted.memberships.get(name) ?? []] as const)
            .filter(([, unions]) => unions.length > 0);

        const fingerprint = hashFingerprint({
            kind: 'models',
            v: CSHARP_CODEGEN_VERSION,
            relPath,
            namespace: namespaceName,
            root,
            externalBases,
            modelsWithInput: relevantInputModels,
            ownedDeclarations,
            declaredMemberships,
        });

        units.push({
            key: `models::${relPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: relPath,
                    content: generateCSharpModels(root, {
                        namespace: namespaceName,
                        modelsWithInput,
                        modelIndex,
                        hoisted,
                        warn: message => ctx.warn?.(message, root.file),
                    }),
                },
            ],
        });
    }

    // The runtime is a constant, and the aggregator depends only on the list of public clients.
    // Both are small enough that rewriting them every run beats a cache entry.
    const globalFiles: IncrementalOutputFile[] = [
        { relativePath: 'Runtime/Converters.cs', content: generateConvertersCs(namespaceName) },
        { relativePath: 'Runtime/SdkRuntime.cs', content: generateRuntimeCs(namespaceName) },
        { relativePath: `${sdkName}.cs`, content: generateSdkCs(namespaceName, sdkName, clients) },
    ];

    // `ifAbsent` marks this user-owned: written once, never overwritten, and never removed as an
    // orphan when the generated tree changes around it.
    if (config.scaffold) {
        globalFiles.push({ relativePath: `${sdkName}.csproj`, content: generateCsproj(namespaceName, sdkName), ifAbsent: true });
    }

    const result = runIncrementalCodegen({
        codegenVersion: CSHARP_CODEGEN_VERSION,
        prevManifest,
        globalFiles,
        units,
        fileExists: relPath => existsSync(resolve(outDir, relPath)),
    });

    deleteStalePaths(outDir, result.deletedPaths);

    for (const { relativePath, content, ifAbsent } of result.filesToWrite) {
        ctx.emitFile(resolve(outDir, relativePath), content, ifAbsent ? { ifAbsent: true } : undefined);
    }

    writeManifest(manifestPath, result.manifest);
}

/** Every model name a contract root references but may not define, including its bases. */
function referencedModelNames(root: ContractRootNode): Set<string> {
    const refs = new Set<string>();
    for (const model of root.models) {
        if (model.type) collectTypeRefs(model.type, refs);
        for (const f of model.fields) collectTypeRefs(f.type, refs);
        if (model.bases) for (const base of model.bases) refs.add(base);
    }
    return refs;
}

/** Read the previous run's manifest. Returns an empty manifest when missing or unreadable. */
function readManifest(manifestPath: string): IncrementalManifest {
    if (!existsSync(manifestPath)) return emptyIncrementalManifest(CSHARP_CODEGEN_VERSION);
    try {
        return parseIncrementalManifest(readFileSync(manifestPath, 'utf-8'));
    } catch {
        return emptyIncrementalManifest(CSHARP_CODEGEN_VERSION);
    }
}

/** Write the manifest. Errors are swallowed so a broken cache never blocks the build. */
function writeManifest(manifestPath: string, manifest: IncrementalManifest): void {
    try {
        mkdirSync(dirname(manifestPath), { recursive: true });
        writeFileSync(manifestPath, serializeIncrementalManifest(manifest), 'utf-8');
    } catch {
        // best-effort
    }
}

/**
 * Delete paths from the prior manifest that aren't produced this run, then prune the directories
 * they leave empty. The output tree is nested (`Models/`, `Clients/`, `Runtime/`), so a renamed
 * `.ck` file would otherwise leave an empty directory behind.
 */
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
