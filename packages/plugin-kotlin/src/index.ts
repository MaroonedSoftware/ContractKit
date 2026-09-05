import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import type {
    ContractKitPlugin,
    ContractRootNode,
    ContractTypeNode,
    IncrementalManifest,
    IncrementalOutputFile,
    IncrementalUnit,
    ModelNode,
    OpRootNode,
    ParamSource,
    PluginContext,
} from '@contractkit/core';
import {
    buildModelIndex,
    collectTransitiveModelRefs,
    collectTypeRefs,
    emptyIncrementalManifest,
    hashFingerprint,
    parseIncrementalManifest,
    runIncrementalCodegen,
    serializeIncrementalManifest,
} from '@contractkit/core';
import { generateKotlinModels, resolveModelsWithInput } from './codegen-models.js';
import { deriveClientClassName, deriveClientPropertyName, generateKotlinClient, hasPublicOperations } from './codegen-client.js';
import { generateSdkKt, type SdkAggregatorClient } from './codegen-sdk.js';
import { collectHoistedTypes } from './hoist.js';
import { generateRuntimeKt } from './runtime.js';
import { generateBuildGradleKts, generateGradleProperties, generateSettingsGradleKts } from './scaffold.js';
import { generateSerializersKt } from './runtime-serializers.js';
import { KOTLIN_HARD_KEYWORDS, deriveKotlinFileBase } from './naming.js';

export interface KotlinSdkPluginConfig {
    /** Output directory relative to rootDir (default: "kotlin-sdk") */
    baseDir?: string;
    /** Kotlin package for the generated sources, e.g. "com.acme.sdk" (default: "contractkit.sdk") */
    packageName?: string;
    /** Aggregator class name (default: "Sdk"). Also the Gradle `rootProject.name` when scaffolding. */
    sdkName?: string;
    /**
     * Whether to emit client methods for operations marked `internal`. Defaults to `false` —
     * internal ops are omitted so consumers don't pick them up.
     */
    includeInternal?: boolean;
    /** Emit `build.gradle.kts` and friends once, as user-owned files. Never overwritten. */
    scaffold?: boolean;
}

/**
 * Bumped when the Kotlin codegen output shape changes in a way that should invalidate every
 * per-file fingerprint, so a plugin upgrade forces full regeneration even when no `.ck` file
 * has changed.
 */
export const KOTLIN_CODEGEN_VERSION = '1';

const CACHE_MANIFEST_FILENAME = 'kotlin-manifest.json';
const DEFAULT_BASE_DIR = 'kotlin-sdk';
const DEFAULT_PACKAGE_NAME = 'contractkit.sdk';
const DEFAULT_SDK_NAME = 'Sdk';

const plugin: ContractKitPlugin = {
    name: 'kotlin-sdk',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as KotlinSdkPluginConfig;
        await runKotlinCodegen(inputs, ctx, config, ctx.rootDir);
    },
};

export default plugin;

export function createKotlinSdkPlugin(config: KotlinSdkPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'kotlin-sdk',
        async generateTargets(inputs, ctx) {
            await runKotlinCodegen(inputs, ctx, config, rootDir);
        },
    };
}

const PACKAGE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const SDK_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reject config that would generate Kotlin which cannot compile. These are runtime checks, not
 * just types: config arrives as JSON, so the TypeScript interface constrains programmatic callers
 * only.
 */
export function assertValidConfig(config: KotlinSdkPluginConfig): void {
    const { packageName, sdkName } = config;
    if (packageName !== undefined) {
        if (typeof packageName !== 'string' || !PACKAGE_NAME_RE.test(packageName)) {
            throw new Error(
                `plugin-kotlin: packageName '${String(packageName)}' is not a valid Kotlin package — expected dot-separated identifiers, e.g. 'com.acme.sdk'.`,
            );
        }
        const keyword = packageName.split('.').find(segment => KOTLIN_HARD_KEYWORDS.has(segment));
        if (keyword) {
            throw new Error(
                `plugin-kotlin: packageName '${packageName}' contains the Kotlin keyword '${keyword}', which cannot appear in a package name.`,
            );
        }
    }
    if (sdkName !== undefined && (typeof sdkName !== 'string' || !SDK_NAME_RE.test(sdkName))) {
        throw new Error(`plugin-kotlin: sdkName '${String(sdkName)}' is not a valid Kotlin class name.`);
    }
    for (const key of ['includeInternal', 'scaffold'] as const) {
        const value = config[key];
        if (value !== undefined && typeof value !== 'boolean') {
            throw new Error(`plugin-kotlin: ${key} must be a boolean — got ${JSON.stringify(value)}.`);
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
async function runKotlinCodegen(
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    ctx: PluginContext,
    config: KotlinSdkPluginConfig,
    rootDir: string,
): Promise<void> {
    assertValidConfig(config);

    const { contractRoots, opRoots } = inputs;
    const packageName = config.packageName ?? DEFAULT_PACKAGE_NAME;
    const sdkName = config.sdkName ?? DEFAULT_SDK_NAME;
    const outDir = resolve(rootDir, config.baseDir ?? DEFAULT_BASE_DIR);
    const manifestPath = resolve(ctx.cacheDir, CACHE_MANIFEST_FILENAME);
    const srcRoot = `src/commonMain/kotlin/${packageName.split('.').join('/')}`;

    // Every model shares one Kotlin package, so a cross-file reference resolves by name and the
    // only cross-file input a models unit has is which names carry an Input variant.
    const allModels: ModelNode[] = contractRoots.flatMap(root => root.models);
    const modelIndex = buildModelIndex(allModels);
    // Resolved once over every model, so the hoisting pass and each file's renderer agree on which
    // names carry an `Input` variant.
    const modelsWithInput = resolveModelsWithInput(allModels, inputs.modelsWithInput);
    const modelsWithInputArray = [...modelsWithInput].sort();

    // Names for the anonymous shapes — unions, inline objects, field-level enums — that Kotlin
    // needs a declaration for. Computed across every file at once: a discriminated union declared
    // in one file makes member classes generated in other files implement its sealed interface.
    const hoisted = collectHoistedTypes(contractRoots, {
        modelIndex,
        modelsWithInput,
        warn: (message, file) => ctx.warn?.(message, file),
    });

    const prevManifest: IncrementalManifest = ctx.cacheEnabled ? readManifest(manifestPath) : emptyIncrementalManifest(KOTLIN_CODEGEN_VERSION);
    const units: IncrementalUnit[] = [];

    for (const root of contractRoots) {
        const relPath = `${srcRoot}/models/${deriveKotlinFileBase(root.file)}Models.kt`;
        const ownNames = new Set(root.models.map(m => m.name));
        const referenced = referencedModelNames(root);
        const relevantInputModels = modelsWithInputArray.filter(name => ownNames.has(name) || referenced.has(name));
        // A base declared in another file contributes its fields to a class generated here, so the
        // fingerprint has to move when that base does.
        const externalBases = [...referenced]
            .filter(name => !ownNames.has(name))
            .sort()
            .map(name => modelIndex.get(name))
            .filter((m): m is ModelNode => m !== undefined);

        // Declarations this file owns, and the interfaces its classes implement, are both
        // decided by the whole project, so they belong in the fingerprint alongside the file.
        const ownedDeclarations = (hoisted.byFile.get(root.file) ?? []).map(d => ({ kind: d.kind, name: d.name, needsInput: d.needsInput }));
        const declaredMemberships = [...ownNames]
            .sort()
            .map(name => [name, hoisted.memberships.get(name) ?? []] as const)
            .filter(([, unions]) => unions.length > 0);

        const fingerprint = hashFingerprint({
            kind: 'models',
            v: KOTLIN_CODEGEN_VERSION,
            relPath,
            packageName,
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
                    content: generateKotlinModels(root, {
                        packageName,
                        modelsWithInput,
                        modelIndex,
                        hoisted,
                        warn: message => ctx.warn?.(message, root.file),
                    }),
                },
            ],
        });
    }

    // ── Per-op-root client files ─────────────────────────────────────────────
    const clients: SdkAggregatorClient[] = [];

    for (const root of opRoots) {
        if (!hasPublicOperations(root, config.includeInternal)) continue;
        const relPath = `${srcRoot}/clients/${deriveClientClassName(root.file)}.kt`;
        clients.push({ className: deriveClientClassName(root.file), propertyName: deriveClientPropertyName(root.file) });

        const referenced = referencedOpModels(root, modelIndex);
        const relevantInputModels = modelsWithInputArray.filter(name => referenced.has(name));
        // A client names the models it takes and returns, so the shapes behind those names — and
        // the declarations hoisted out of them — are part of what this file depends on.
        const referencedModels = [...referenced]
            .sort()
            .map(name => modelIndex.get(name))
            .filter((m): m is ModelNode => m !== undefined);

        const fingerprint = hashFingerprint({
            kind: 'client',
            v: KOTLIN_CODEGEN_VERSION,
            relPath,
            packageName,
            root,
            referencedModels,
            modelsWithInput: relevantInputModels,
            includeInternal: config.includeInternal ?? false,
        });

        units.push({
            key: `client::${relPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: relPath,
                    content: generateKotlinClient(root, {
                        packageName,
                        modelsWithInput,
                        modelIndex,
                        hoisted,
                        includeInternal: config.includeInternal,
                        warn: message => ctx.warn?.(message, root.file),
                    }),
                },
            ],
        });
    }

    // The runtime is a constant, and the aggregator depends only on the list of public clients.
    // Both are small enough that rewriting them every run beats a cache entry.
    const globalFiles: IncrementalOutputFile[] = [
        { relativePath: `${srcRoot}/runtime/Serializers.kt`, content: generateSerializersKt(packageName) },
        { relativePath: `${srcRoot}/runtime/SdkRuntime.kt`, content: generateRuntimeKt(packageName) },
        { relativePath: `${srcRoot}/${sdkName}.kt`, content: generateSdkKt(packageName, sdkName, clients) },
    ];

    // `ifAbsent` marks these user-owned: written once, never overwritten, and never removed as
    // orphans when the generated tree changes around them.
    if (config.scaffold) {
        globalFiles.push(
            { relativePath: 'build.gradle.kts', content: generateBuildGradleKts(), ifAbsent: true },
            { relativePath: 'settings.gradle.kts', content: generateSettingsGradleKts(sdkName), ifAbsent: true },
            { relativePath: 'gradle.properties', content: generateGradleProperties(), ifAbsent: true },
        );
    }

    const result = runIncrementalCodegen({
        codegenVersion: KOTLIN_CODEGEN_VERSION,
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

/** Every model name an operations file names, transitively, so the client's inputs are covered. */
function referencedOpModels(root: OpRootNode, modelIndex: Map<string, ModelNode>): Set<string> {
    const seeds: ContractTypeNode[] = [];
    const addParamSource = (source: ParamSource | undefined): void => {
        if (!source) return;
        if (source.kind === 'params') seeds.push(...source.nodes.map(n => n.type));
        else if (source.kind === 'ref') seeds.push({ kind: 'ref', name: source.name });
        else seeds.push(source.node);
    };

    for (const route of root.routes) {
        addParamSource(route.params);
        for (const op of route.operations) {
            addParamSource(op.query);
            addParamSource(op.headers);
            for (const body of op.request?.bodies ?? []) seeds.push(body.bodyType);
            for (const response of op.responses) {
                for (const body of response.bodies) seeds.push(body.bodyType);
                for (const header of response.headers ?? []) seeds.push(header.type);
            }
        }
    }

    return collectTransitiveModelRefs(seeds, modelIndex);
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
    if (!existsSync(manifestPath)) return emptyIncrementalManifest(KOTLIN_CODEGEN_VERSION);
    try {
        return parseIncrementalManifest(readFileSync(manifestPath, 'utf-8'));
    } catch {
        return emptyIncrementalManifest(KOTLIN_CODEGEN_VERSION);
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
 * they leave empty. The output tree is nested (`models/`, `clients/`, `runtime/`), so a renamed
 * `.ck` file would otherwise leave an empty package directory behind.
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
