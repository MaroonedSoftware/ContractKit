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
import { generateSwiftModels, resolveModelsWithInput } from './codegen-models.js';
import { deriveClientClassName, deriveClientPropertyName, generateSwiftClient, hasPublicOperations } from './codegen-client.js';
import { generateSdkSwift, type SdkAggregatorClient } from './codegen-sdk.js';
import { collectHoistedTypes } from './hoist.js';
import { collectBoxedFields } from './recursion.js';
import { generateRuntimeSwift } from './runtime.js';
import { generateJSONValueSwift } from './runtime-json.js';
import { generateScalarsSwift } from './runtime-scalars.js';
import { generatePackageSwift } from './scaffold.js';
import { RESERVED_TYPE_NAMES, SWIFT_RESERVED_WORDS, deriveSwiftFileBase } from './naming.js';

export interface SwiftSdkPluginConfig {
    /** Output directory relative to rootDir (default: "swift-sdk") */
    baseDir?: string;
    /**
     * The SwiftPM target and product name, i.e. the module the generated sources compile into
     * (default: "ContractKitSdk"). Sources land in `Sources/<moduleName>/`.
     */
    moduleName?: string;
    /** Aggregator class name (default: "Sdk"). Must differ from `moduleName`. */
    sdkName?: string;
    /**
     * Whether to emit client methods for operations marked `internal`. Defaults to `false` —
     * internal ops are omitted so consumers don't pick them up.
     */
    includeInternal?: boolean;
    /** Emit `Package.swift` once, as a user-owned file. Never overwritten. */
    scaffold?: boolean;
}

/**
 * Bumped when the Swift codegen output shape changes in a way that should invalidate every
 * per-file fingerprint, so a plugin upgrade forces full regeneration even when no `.ck` file
 * has changed.
 */
export const SWIFT_CODEGEN_VERSION = '2';

const CACHE_MANIFEST_FILENAME = 'swift-manifest.json';
const DEFAULT_BASE_DIR = 'swift-sdk';
const DEFAULT_MODULE_NAME = 'ContractKitSdk';
const DEFAULT_SDK_NAME = 'Sdk';

const plugin: ContractKitPlugin = {
    name: 'swift-sdk',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as SwiftSdkPluginConfig;
        await runSwiftCodegen(inputs, ctx, config, ctx.rootDir);
    },
};

export default plugin;

export function createSwiftSdkPlugin(config: SwiftSdkPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'swift-sdk',
        async generateTargets(inputs, ctx) {
            await runSwiftCodegen(inputs, ctx, config, rootDir);
        },
    };
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reject config that would generate Swift which cannot compile. These are runtime checks, not
 * just types: config arrives as JSON, so the TypeScript interface constrains programmatic callers
 * only.
 */
export function assertValidConfig(config: SwiftSdkPluginConfig): void {
    for (const key of ['moduleName', 'sdkName'] as const) {
        const value = config[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
            throw new Error(`plugin-swift: ${key} '${String(value)}' is not a valid Swift identifier.`);
        }
        if (SWIFT_RESERVED_WORDS.has(value)) {
            throw new Error(`plugin-swift: ${key} '${value}' is a Swift reserved word.`);
        }
        if (RESERVED_TYPE_NAMES.has(value)) {
            throw new Error(`plugin-swift: ${key} '${value}' collides with a type the generated code relies on.`);
        }
    }
    const moduleName = config.moduleName ?? DEFAULT_MODULE_NAME;
    const sdkName = config.sdkName ?? DEFAULT_SDK_NAME;
    if (moduleName === sdkName) {
        throw new Error(
            `plugin-swift: moduleName and sdkName are both '${moduleName}'. A type named like its module cannot be referred to by its qualified name; give the two different names.`,
        );
    }
    for (const key of ['includeInternal', 'scaffold'] as const) {
        const value = config[key];
        if (value !== undefined && typeof value !== 'boolean') {
            throw new Error(`plugin-swift: ${key} must be a boolean — got ${JSON.stringify(value)}.`);
        }
    }
}

/**
 * Reject a contract whose name would shadow a type the generated code refers to unqualified. A
 * model named `Error` breaks every `throws` in the client; one named `SdkHttp` replaces the
 * runtime. Reported here, where the contract author can act on it, rather than by the compiler.
 */
function assertModelNamesUsable(models: readonly ModelNode[], moduleName: string, sdkName: string): void {
    for (const model of models) {
        if (RESERVED_TYPE_NAMES.has(model.name)) {
            throw new Error(
                `plugin-swift: contract '${model.name}' (${model.loc.file}:${model.loc.line}) collides with a Swift or runtime type the generated code relies on. Rename the contract.`,
            );
        }
        if (model.name === sdkName) {
            throw new Error(
                `plugin-swift: contract '${model.name}' has the same name as the SDK class. Rename one of them (sdkName in the plugin config).`,
            );
        }
        if (model.name === moduleName) {
            throw new Error(
                `plugin-swift: contract '${model.name}' has the same name as the Swift module. Rename one of them (moduleName in the plugin config).`,
            );
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
async function runSwiftCodegen(
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    ctx: PluginContext,
    config: SwiftSdkPluginConfig,
    rootDir: string,
): Promise<void> {
    assertValidConfig(config);

    const { contractRoots, opRoots } = inputs;
    const moduleName = config.moduleName ?? DEFAULT_MODULE_NAME;
    const sdkName = config.sdkName ?? DEFAULT_SDK_NAME;
    const outDir = resolve(rootDir, config.baseDir ?? DEFAULT_BASE_DIR);
    const manifestPath = resolve(ctx.cacheDir, CACHE_MANIFEST_FILENAME);
    const srcRoot = `Sources/${moduleName}`;

    // Every generated file shares one Swift module, so a cross-file reference resolves by name and
    // the only cross-file input a models unit has is which names carry an Input variant.
    const allModels: ModelNode[] = contractRoots.flatMap(root => root.models);
    assertModelNamesUsable(allModels, moduleName, sdkName);
    const modelIndex = buildModelIndex(allModels);
    // Resolved once over every model, so the hoisting pass and each file's renderer agree on which
    // names carry an `Input` variant.
    const modelsWithInput = resolveModelsWithInput(allModels, inputs.modelsWithInput);
    const modelsWithInputArray = [...modelsWithInput].sort();

    // Names for the anonymous shapes — unions, inline objects, tuples, field-level enums — that
    // Swift needs a declaration for. Computed across every file at once, because every file lands
    // in one module where the names have to be unique.
    const hoisted = collectHoistedTypes(contractRoots, {
        modelIndex,
        modelsWithInput,
        reservedNames: RESERVED_TYPE_NAMES,
        warn: (message, file) => ctx.warn?.(message, file),
    });

    // The stored properties that would make a struct contain itself. A cycle can run through
    // models in several files, so this too is a whole-project answer.
    const boxed = collectBoxedFields(contractRoots, { modelIndex, hoisted });

    const prevManifest: IncrementalManifest = ctx.cacheEnabled ? readManifest(manifestPath) : emptyIncrementalManifest(SWIFT_CODEGEN_VERSION);
    const units: IncrementalUnit[] = [];

    for (const root of contractRoots) {
        const relPath = `${srcRoot}/Models/${deriveSwiftFileBase(root.file)}Models.swift`;
        const ownNames = new Set(root.models.map(m => m.name));
        const referenced = referencedModelNames(root);
        const relevantInputModels = modelsWithInputArray.filter(name => ownNames.has(name) || referenced.has(name));
        // A base declared in another file contributes its fields to a struct generated here, so the
        // fingerprint has to move when that base does.
        const externalBases = [...referenced]
            .filter(name => !ownNames.has(name))
            .sort()
            .map(name => modelIndex.get(name))
            .filter((m): m is ModelNode => m !== undefined);

        // Declarations this file owns, and the properties it has to box, are both decided by the
        // whole project, so they belong in the fingerprint alongside the file.
        const ownedDeclarations = (hoisted.byFile.get(root.file) ?? []).map(d => ({ kind: d.kind, name: d.name, needsInput: d.needsInput }));
        const ownedNames = new Set([...ownNames, ...ownedDeclarations.map(d => d.name)]);
        const boxedHere = [...boxed].filter(key => ownedNames.has(key.slice(0, key.indexOf('.'))));

        const fingerprint = hashFingerprint({
            kind: 'models',
            v: SWIFT_CODEGEN_VERSION,
            relPath,
            root,
            externalBases,
            modelsWithInput: relevantInputModels,
            ownedDeclarations,
            boxed: boxedHere,
        });

        units.push({
            key: `models::${relPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: relPath,
                    content: generateSwiftModels(root, {
                        modelsWithInput,
                        modelIndex,
                        hoisted,
                        boxed,
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
        const relPath = `${srcRoot}/Clients/${deriveClientClassName(root.file)}.swift`;
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
            v: SWIFT_CODEGEN_VERSION,
            relPath,
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
                    content: generateSwiftClient(root, {
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
        { relativePath: `${srcRoot}/Runtime/JSONValue.swift`, content: generateJSONValueSwift() },
        { relativePath: `${srcRoot}/Runtime/Scalars.swift`, content: generateScalarsSwift() },
        { relativePath: `${srcRoot}/Runtime/SdkRuntime.swift`, content: generateRuntimeSwift() },
        { relativePath: `${srcRoot}/${sdkName}.swift`, content: generateSdkSwift(sdkName, clients) },
    ];

    // `ifAbsent` marks it user-owned: written once, never overwritten, and never removed as an
    // orphan when the generated tree changes around it.
    if (config.scaffold) {
        globalFiles.push({ relativePath: 'Package.swift', content: generatePackageSwift(moduleName), ifAbsent: true });
    }

    const result = runIncrementalCodegen({
        codegenVersion: SWIFT_CODEGEN_VERSION,
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
    if (!existsSync(manifestPath)) return emptyIncrementalManifest(SWIFT_CODEGEN_VERSION);
    try {
        return parseIncrementalManifest(readFileSync(manifestPath, 'utf-8'));
    } catch {
        return emptyIncrementalManifest(SWIFT_CODEGEN_VERSION);
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
