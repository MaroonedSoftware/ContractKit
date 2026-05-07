import { resolve, join, relative, dirname, basename } from 'node:path';
import { existsSync, readFileSync, rmSync, readdirSync, rmdirSync } from 'node:fs';
import { generateContract } from './codegen-contract.js';
import { generateOp } from './codegen-operation.js';
import type {
    ContractKitPlugin,
    PluginContext,
    ContractRootNode,
    OpRootNode,
    ModelNode,
    IncrementalManifest,
    IncrementalUnit,
    IncrementalOutputFile,
} from '@contractkit/core';
import {
    runIncrementalCodegen,
    parseIncrementalManifest,
    emptyIncrementalManifest,
    hashFingerprint,
    collectTransitiveModelRefs,
    collectTypeRefs,
} from '@contractkit/core';
import {
    generateSdk,
    generateSdkOptions,
    generateSdkAggregator,
    deriveClientClassName,
    deriveClientPropertyName,
    deriveSubareaClientClassName,
    deriveSubareaPropertyName,
    getAreaSubarea,
    hasPublicOperations,
    type SdkClientInfo,
    type SdkAreaInfo,
} from './codegen-sdk.js';
import { generatePlainTypes } from './codegen-plain-types.js';
import {
    TEMPLATE_VAR_RE,
    resolveTemplate,
    commonDir,
    computeOpOutPath,
    computeContractOutPath,
    computeSdkOutPath,
    computeSdkTypeOutPath,
    generateBarrelFiles,
    computePubliclyReachableTypes,
} from './path-utils.js';

// ─── Sub-config interfaces ─────────────────────────────────────────────────

export interface ServerConfig {
    /** Directory (relative to rootDir) where server files are written. Default: rootDir. */
    baseDir?: string;
    /** When true, `output.types` emits Zod schema files (via `generateContract`). When false/omitted, emits plain TypeScript. */
    zod?: boolean;
    output?: {
        /** Path template for Koa router files. Supports {filename}, {dir}, {area}. */
        routes?: string;
        /** Path template for type/schema files. Supports {filename}, {dir}, {area}. */
        types?: string;
    };
    /** Import path template for service implementations. */
    servicePathTemplate?: string;
    /** Whether to emit handlers for `internal` operations. Default true. */
    includeInternal?: boolean;
}

export interface SdkConfig {
    baseDir?: string;
    name?: string;
    zod?: boolean;
    output?: {
        sdk?: string;
        types?: string;
        clients?: string;
    };
    includeInternal?: boolean;
}

export interface ZodConfig {
    baseDir?: string;
    output?: string;
}

export interface TypesConfig {
    baseDir?: string;
    output?: string;
}

export interface TypescriptPluginConfig {
    server?: ServerConfig;
    sdk?: SdkConfig;
    zod?: ZodConfig;
    types?: TypesConfig;
}

// ─── Caching constants ─────────────────────────────────────────────────────

/** Bumped when the codegen output shape changes in a way that should bust every per-file fingerprint. */
export const TYPESCRIPT_CODEGEN_VERSION = '1';

const MANIFEST_FILENAME = '.contractkit-typescript-manifest.json';

// ─── Plugin entry points ──────────────────────────────────────────────────

const plugin: ContractKitPlugin = {
    name: 'typescript',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as TypescriptPluginConfig;
        await runTypescriptCodegen(inputs, ctx, config, ctx.rootDir);
    },
};

export default plugin;

/** Build a `@contractkit/plugin-typescript` instance with explicit configuration, for programmatic use. */
export function createTypescriptPlugin(config: TypescriptPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'typescript',
        async generateTargets(inputs, ctx) {
            await runTypescriptCodegen(inputs, ctx, config, rootDir);
        },
    };
}

/**
 * Shared orchestration. Each sub-generator (server / sdk / zod / types) contributes a
 * set of cacheable units (per-file fingerprints) plus a set of always-regenerated global
 * files (aggregators, barrels, sdk-options). Units share a single manifest so the cache
 * survives cross-cutting reads — the manifest lives at `<rootDir>/.contractkit-typescript-manifest.json`.
 *
 * Honors `ctx.cacheEnabled` — `--force` bypasses the manifest entirely.
 */
async function runTypescriptCodegen(
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    ctx: PluginContext,
    config: TypescriptPluginConfig,
    rootDir: string,
): Promise<void> {
    const manifestPath = resolve(rootDir, MANIFEST_FILENAME);
    const prevManifest: IncrementalManifest = ctx.cacheEnabled ? readManifest(manifestPath) : emptyIncrementalManifest(TYPESCRIPT_CODEGEN_VERSION);

    const units: IncrementalUnit[] = [];
    const globalFiles: IncrementalOutputFile[] = [];

    if (config.server) collectServerOutput(config.server, rootDir, inputs, units);
    if (config.sdk) collectSdkOutput(config.sdk, rootDir, inputs, units, globalFiles);
    if (config.zod) collectZodOutput(config.zod, rootDir, inputs, units);
    if (config.types) collectTypesOutput(config.types, rootDir, inputs, units);

    const result = runIncrementalCodegen({
        codegenVersion: TYPESCRIPT_CODEGEN_VERSION,
        manifestFilename: manifestPath,
        prevManifest,
        globalFiles,
        units,
        // Paths are absolute, so existsSync works directly.
        fileExists: existsSync,
    });

    deleteStalePaths(result.deletedPaths);

    for (const { relativePath, content } of result.filesToWrite) {
        ctx.emitFile(relativePath, content);
    }
}

// ─── Cross-file dependency analysis ────────────────────────────────────────

/** Build a quick lookup from model name → its definition. */
function buildModelMap(contractRoots: readonly ContractRootNode[]): Map<string, ModelNode> {
    const map = new Map<string, ModelNode>();
    for (const root of contractRoots) {
        for (const model of root.models) map.set(model.name, model);
    }
    return map;
}

/** Collect every model referenced by this contract root (own models' fields + bases). Used to slice cross-file fingerprint inputs to just what this file actually depends on. */
function collectContractRootRefs(root: ContractRootNode, modelMap: Map<string, ModelNode>): Set<string> {
    const seeds: Parameters<typeof collectTypeRefs>[0][] = [];
    for (const m of root.models) {
        if (m.type) seeds.push(m.type);
        for (const f of m.fields) seeds.push(f.type);
        if (m.bases) {
            for (const b of m.bases) seeds.push({ kind: 'ref', name: b } as Parameters<typeof collectTypeRefs>[0]);
        }
    }
    return collectTransitiveModelRefs(seeds, modelMap);
}

/** Collect every model referenced by an op root's routes/operations (transitive). */
function collectOpRootRefs(root: OpRootNode, modelMap: Map<string, ModelNode>): Set<string> {
    const seeds: Parameters<typeof collectTypeRefs>[0][] = [];
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

/** Build a sorted, JSON-stable record of (modelName -> outPath) for refs this unit depends on. */
function sliceOutPathMap(refs: Set<string>, modelOutPaths: Map<string, string>, modelsWithInput: Set<string>, modelsWithOutput: Set<string>): Record<string, string> {
    const slice: Record<string, string> = {};
    for (const ref of [...refs].sort()) {
        const p = modelOutPaths.get(ref);
        if (p) slice[ref] = p;
        if (modelsWithInput.has(ref)) {
            const ip = modelOutPaths.get(`${ref}Input`);
            if (ip) slice[`${ref}Input`] = ip;
        }
        if (modelsWithOutput.has(ref)) {
            const op = modelOutPaths.get(`${ref}Output`);
            if (op) slice[`${ref}Output`] = op;
        }
    }
    return slice;
}

/** Slice modelsWithInput/Output to only the names relevant to this unit. */
function sliceModelSet(refs: Set<string>, ownNames: Set<string>, set: Set<string>): string[] {
    const result: string[] = [];
    for (const name of set) {
        if (refs.has(name) || ownNames.has(name)) result.push(name);
    }
    return result.sort();
}

// ─── Server sub-generator ──────────────────────────────────────────────────

function collectServerOutput(
    config: ServerConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    units: IncrementalUnit[],
): void {
    const serverBase = resolve(rootDir, config.baseDir ?? '.');
    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const modelsWithOutput = inputs.modelsWithOutput as Set<string>;
    const modelMap = buildModelMap(inputs.contractRoots);
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const commonRoot = commonDir(allFiles, rootDir);
    const subConfigKey = stableSubConfig(config);

    // Pre-pass: register all model → outPath. Cross-file refs need to resolve correctly,
    // which means we need the COMPLETE map (not a slice) — even though each unit's fingerprint
    // only includes its own slice.
    const serverModelOutPaths = new Map<string, string>();
    const typeEntries: { ast: ContractRootNode; typeOutPath: string }[] = [];
    if (config.output?.types) {
        for (const ast of inputs.contractRoots) {
            const typeOutPath = computeContractOutPath(ast.file, serverBase, config.output.types, '.ts', commonRoot, ast.meta);
            typeEntries.push({ ast, typeOutPath });
            for (const model of ast.models) {
                serverModelOutPaths.set(model.name, typeOutPath);
                if (modelsWithInput.has(model.name)) serverModelOutPaths.set(`${model.name}Input`, typeOutPath);
                if (modelsWithOutput.has(model.name)) serverModelOutPaths.set(`${model.name}Output`, typeOutPath);
            }
        }
    }

    // ── Per-contract-root types unit ──
    for (const { ast, typeOutPath } of typeEntries) {
        const refs = collectContractRootRefs(ast, modelMap);
        const ownNames = new Set(ast.models.map(m => m.name));
        const fingerprint = hashFingerprint({
            kind: 'server-types',
            v: TYPESCRIPT_CODEGEN_VERSION,
            outPath: typeOutPath,
            root: ast,
            outPathSlice: sliceOutPathMap(refs, serverModelOutPaths, modelsWithInput, modelsWithOutput),
            modelsWithInput: sliceModelSet(refs, ownNames, modelsWithInput),
            modelsWithOutput: sliceModelSet(refs, ownNames, modelsWithOutput),
            sub: subConfigKey,
        });
        units.push({
            key: `server-types::${typeOutPath}`,
            fingerprint,
            render: () => {
                const renderCtx = {
                    modelOutPaths: serverModelOutPaths,
                    currentOutPath: typeOutPath,
                    modelsWithInput,
                    modelsWithOutput,
                };
                const content = config.zod ? generateContract(ast, renderCtx) : generatePlainTypes(ast, renderCtx);
                return [{ relativePath: typeOutPath, content }];
            },
        });
    }

    // ── Per-op-root router unit ──
    for (const ast of inputs.opRoots) {
        const outPath = computeOpOutPath(ast.file, serverBase, config.output?.routes, '.router.ts', commonRoot, ast.meta);
        const refs = collectOpRootRefs(ast, modelMap);
        const fingerprint = hashFingerprint({
            kind: 'server-router',
            v: TYPESCRIPT_CODEGEN_VERSION,
            outPath,
            root: ast,
            // The router imports types from each contract root's type file; the slice covers exactly that.
            outPathSlice: sliceOutPathMap(refs, serverModelOutPaths, modelsWithInput, modelsWithOutput),
            modelsWithInput: sliceModelSet(refs, new Set(), modelsWithInput),
            modelsWithOutput: sliceModelSet(refs, new Set(), modelsWithOutput),
            servicePathTemplate: config.servicePathTemplate ?? null,
            includeInternal: config.includeInternal ?? true,
            sub: subConfigKey,
        });
        units.push({
            key: `server-router::${outPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: outPath,
                    content: generateOp(ast, {
                        servicePathTemplate: config.servicePathTemplate,
                        outPath,
                        modelOutPaths: serverModelOutPaths,
                        modelsWithInput,
                        modelsWithOutput,
                        includeInternal: config.includeInternal,
                    }),
                },
            ],
        });
    }
}

// ─── SDK sub-generator ─────────────────────────────────────────────────────

function collectSdkOutput(
    config: SdkConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    units: IncrementalUnit[],
    globalFiles: IncrementalOutputFile[],
): void {
    const sdkBase = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
    const sdkName = config.name;
    const sdkOutput = config.output?.sdk;
    const sdkEntryPath = sdkOutput
        ? join(sdkBase, TEMPLATE_VAR_RE.test(sdkOutput) ? resolveTemplate(sdkOutput, { name: sdkName ?? 'sdk' }) : sdkOutput)
        : join(sdkBase, 'sdk.ts');
    const sdkOptionsPath = join(dirname(sdkEntryPath), 'sdk-options.ts');
    const subConfigKey = stableSubConfig(config);

    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const modelsWithOutput = inputs.modelsWithOutput as Set<string>;
    const modelMap = buildModelMap(inputs.contractRoots);
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const ckCommonRoot = commonDir(allFiles, rootDir);

    const sdkModelOutPaths = new Map<string, string>();
    const sdkTypePaths: string[] = [];
    const sdkClientInfos: { outPath: string; className: string; propertyName: string }[] = [];

    // ── Pre-pass: SDK type files ──
    const sdkContractEntries: { ast: ContractRootNode; typeOutPath: string }[] = [];
    if (config.output?.types) {
        const publicTypes = computePubliclyReachableTypes(inputs.opRoots, inputs.contractRoots, modelsWithInput, modelsWithOutput);
        for (const ast of inputs.contractRoots) {
            const typeOutPath = computeSdkTypeOutPath(ast.file, sdkBase, config.output.types, ckCommonRoot, ast.meta);
            if (!typeOutPath) continue;
            if (publicTypes !== null && !ast.models.some(m => publicTypes.has(m.name))) continue;
            sdkTypePaths.push(typeOutPath);
            sdkContractEntries.push({ ast, typeOutPath });
            for (const model of ast.models) {
                sdkModelOutPaths.set(model.name, typeOutPath);
                if (modelsWithInput.has(model.name)) sdkModelOutPaths.set(`${model.name}Input`, typeOutPath);
                if (modelsWithOutput.has(model.name)) sdkModelOutPaths.set(`${model.name}Output`, typeOutPath);
            }
        }
    }

    // ── SDK type units ──
    for (const { ast, typeOutPath } of sdkContractEntries) {
        const refs = collectContractRootRefs(ast, modelMap);
        const ownNames = new Set(ast.models.map(m => m.name));
        const fingerprint = hashFingerprint({
            kind: 'sdk-types',
            v: TYPESCRIPT_CODEGEN_VERSION,
            outPath: typeOutPath,
            root: ast,
            outPathSlice: sliceOutPathMap(refs, sdkModelOutPaths, modelsWithInput, modelsWithOutput),
            modelsWithInput: sliceModelSet(refs, ownNames, modelsWithInput),
            modelsWithOutput: sliceModelSet(refs, ownNames, modelsWithOutput),
            sdkOptionsPath,
            sub: subConfigKey,
        });
        units.push({
            key: `sdk-types::${typeOutPath}`,
            fingerprint,
            render: () => {
                let content: string;
                if (config.zod) {
                    content = generateContract(ast, {
                        modelOutPaths: sdkModelOutPaths,
                        currentOutPath: typeOutPath,
                        modelsWithInput,
                        modelsWithOutput,
                    });
                } else {
                    let rel = relative(dirname(typeOutPath), sdkOptionsPath).replace(/\.ts$/, '.js');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    content = generatePlainTypes(ast, {
                        modelOutPaths: sdkModelOutPaths,
                        currentOutPath: typeOutPath,
                        modelsWithInput,
                        modelsWithOutput,
                        jsonValueImportPath: rel,
                    });
                }
                return [{ relativePath: typeOutPath, content }];
            },
        });
    }

    // ── Bucket op roots by area/subarea ──
    interface AreaBucket {
        leaves: { ast: OpRootNode; outPath: string; subarea: string }[];
        inlineRoots: OpRootNode[];
    }
    const areaBuckets = new Map<string, AreaBucket>();
    const topLevelEntries: { ast: OpRootNode; outPath: string }[] = [];

    if (config.output?.clients) {
        for (const ast of inputs.opRoots) {
            const sdkOutPath = computeSdkOutPath(ast.file, sdkBase, config.output.clients, ckCommonRoot, ast.meta);
            if (!sdkOutPath || !hasPublicOperations(ast, config.includeInternal)) continue;
            const { area, subarea } = getAreaSubarea(ast);
            if (area && subarea) {
                const bucket = areaBuckets.get(area) ?? { leaves: [], inlineRoots: [] };
                bucket.leaves.push({ ast, outPath: sdkOutPath, subarea });
                areaBuckets.set(area, bucket);
            } else if (area) {
                const bucket = areaBuckets.get(area) ?? { leaves: [], inlineRoots: [] };
                bucket.inlineRoots.push(ast);
                areaBuckets.set(area, bucket);
            } else {
                topLevelEntries.push({ ast, outPath: sdkOutPath });
            }
        }

        // ── Per-leaf-client (area+subarea) units ──
        for (const [area, bucket] of areaBuckets.entries()) {
            for (const leaf of bucket.leaves) {
                const className = deriveSubareaClientClassName(area, leaf.subarea);
                sdkClientInfos.push({ outPath: leaf.outPath, className, propertyName: deriveSubareaPropertyName(leaf.subarea) });
                const refs = collectOpRootRefs(leaf.ast, modelMap);
                const fingerprint = hashFingerprint({
                    kind: 'sdk-leaf-client',
                    v: TYPESCRIPT_CODEGEN_VERSION,
                    outPath: leaf.outPath,
                    root: leaf.ast,
                    outPathSlice: sliceOutPathMap(refs, sdkModelOutPaths, modelsWithInput, modelsWithOutput),
                    modelsWithInput: sliceModelSet(refs, new Set(), modelsWithInput),
                    modelsWithOutput: sliceModelSet(refs, new Set(), modelsWithOutput),
                    sdkOptionsPath,
                    className,
                    includeInternal: config.includeInternal ?? false,
                    sub: subConfigKey,
                });
                units.push({
                    key: `sdk-leaf-client::${leaf.outPath}`,
                    fingerprint,
                    render: () => [
                        {
                            relativePath: leaf.outPath,
                            content: generateSdk(leaf.ast, {
                                typeImportPathTemplate: undefined,
                                outPath: leaf.outPath,
                                modelOutPaths: sdkModelOutPaths,
                                sdkOptionsPath,
                                modelsWithInput,
                                modelsWithOutput,
                                includeInternal: config.includeInternal,
                                clientClassName: className,
                            }),
                        },
                    ],
                });
            }
        }

        // ── Top-level (no area) client units ──
        for (const { ast, outPath } of topLevelEntries) {
            const className = deriveClientClassName(ast.file);
            sdkClientInfos.push({ outPath, className, propertyName: deriveClientPropertyName(ast.file) });
            const refs = collectOpRootRefs(ast, modelMap);
            const fingerprint = hashFingerprint({
                kind: 'sdk-top-client',
                v: TYPESCRIPT_CODEGEN_VERSION,
                outPath,
                root: ast,
                outPathSlice: sliceOutPathMap(refs, sdkModelOutPaths, modelsWithInput, modelsWithOutput),
                modelsWithInput: sliceModelSet(refs, new Set(), modelsWithInput),
                modelsWithOutput: sliceModelSet(refs, new Set(), modelsWithOutput),
                sdkOptionsPath,
                includeInternal: config.includeInternal ?? false,
                sub: subConfigKey,
            });
            units.push({
                key: `sdk-top-client::${outPath}`,
                fingerprint,
                render: () => [
                    {
                        relativePath: outPath,
                        content: generateSdk(ast, {
                            typeImportPathTemplate: undefined,
                            outPath,
                            modelOutPaths: sdkModelOutPaths,
                            sdkOptionsPath,
                            modelsWithInput,
                            modelsWithOutput,
                            includeInternal: config.includeInternal,
                        }),
                    },
                ],
            });
        }
    }

    // ── Global files: sdk-options, aggregator, barrels, root index ──
    // The aggregator inlines area-only op roots, so its content depends on each inline root's
    // full AST. Caching it gains little — the codegen is fast and any inline-root change rebuilds
    // the file anyway. Same for barrels (one line per imported file). Always regenerate.
    globalFiles.push({ relativePath: sdkOptionsPath, content: generateSdkOptions() });

    const hasAnything = sdkClientInfos.length > 0 || areaBuckets.size > 0;
    if (hasAnything) {
        const sdkEntryDir = dirname(sdkEntryPath);
        const sdkOptionsRel = relative(sdkEntryDir, sdkOptionsPath).replace(/\.ts$/, '.js');
        const sdkOptionsImportPath = sdkOptionsRel.startsWith('.') ? sdkOptionsRel : './' + sdkOptionsRel;
        const sdkClassName = sdkName
            ? sdkName
                  .split(/[-._\s]+/)
                  .map(s => s.charAt(0).toUpperCase() + s.slice(1))
                  .join('') + 'Sdk'
            : 'Sdk';

        const toClientImport = (info: { outPath: string; className: string; propertyName: string }): SdkClientInfo => {
            let rel = relative(sdkEntryDir, info.outPath).replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            return { className: info.className, propertyName: info.propertyName, importPath: rel };
        };

        const topLevelClients: SdkClientInfo[] = topLevelEntries.map(e => ({
            className: deriveClientClassName(e.ast.file),
            propertyName: deriveClientPropertyName(e.ast.file),
            importPath: (() => {
                const rel = relative(sdkEntryDir, e.outPath).replace(/\.ts$/, '.js');
                return rel.startsWith('.') ? rel : './' + rel;
            })(),
        }));

        const areas: SdkAreaInfo[] = [...areaBuckets.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([area, bucket]) => ({
                area,
                inlineFiles: bucket.inlineRoots.map(root => ({
                    root,
                    codegenOptions: {
                        typeImportPathTemplate: undefined,
                        outPath: sdkEntryPath,
                        modelOutPaths: sdkModelOutPaths,
                        sdkOptionsPath,
                        modelsWithInput,
                        modelsWithOutput,
                        includeInternal: config.includeInternal,
                    },
                })),
                subareaClients: bucket.leaves
                    .sort((a, b) => a.subarea.localeCompare(b.subarea))
                    .map(l => ({
                        propertyName: deriveSubareaPropertyName(l.subarea),
                        client: toClientImport({
                            outPath: l.outPath,
                            className: deriveSubareaClientClassName(area, l.subarea),
                            propertyName: deriveSubareaPropertyName(l.subarea),
                        }),
                    })),
            }));

        globalFiles.push({
            relativePath: sdkEntryPath,
            content: generateSdkAggregator({ topLevelClients, areas, sdkOptionsImportPath, sdkClassName }),
        });
    }

    const sdkSrcDir = dirname(sdkEntryPath);
    const sdkTypeBarrels = generateBarrelFiles(sdkTypePaths);
    for (const barrel of sdkTypeBarrels) globalFiles.push({ relativePath: barrel.outPath, content: barrel.content });

    const rootExports: string[] = [`export * from './${basename(sdkOptionsPath).replace(/\.ts$/, '.js')}';`];
    if (hasAnything) rootExports.push(`export * from './${basename(sdkEntryPath).replace(/\.ts$/, '.js')}';`);
    for (const c of sdkClientInfos) {
        let rel = relative(sdkSrcDir, c.outPath).replace(/\.ts$/, '.js');
        if (!rel.startsWith('.')) rel = './' + rel;
        rootExports.push(`export * from '${rel}';`);
    }
    for (const barrel of sdkTypeBarrels) {
        let rel = relative(sdkSrcDir, barrel.outPath).replace(/\.ts$/, '.js');
        if (!rel.startsWith('.')) rel = './' + rel;
        rootExports.push(`export * from '${rel}';`);
    }
    globalFiles.push({
        relativePath: join(sdkSrcDir, 'index.ts'),
        content: `// Auto-generated barrel file\n${rootExports.sort().join('\n')}\n`,
    });
}

// ─── Zod sub-generator ─────────────────────────────────────────────────────

function collectZodOutput(
    config: ZodConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    units: IncrementalUnit[],
): void {
    const zodBase = resolve(rootDir, config.baseDir ?? '.');
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const commonRoot = commonDir(allFiles, rootDir);
    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const modelsWithOutput = inputs.modelsWithOutput as Set<string>;
    const modelMap = buildModelMap(inputs.contractRoots);
    const subConfigKey = stableSubConfig(config);

    const modelOutPaths = new Map<string, string>();
    const entries: { ast: ContractRootNode; outPath: string }[] = [];
    for (const ast of inputs.contractRoots) {
        const outPath = computeContractOutPath(ast.file, zodBase, config.output, '.schema.ts', commonRoot, ast.meta);
        entries.push({ ast, outPath });
        for (const model of ast.models) {
            modelOutPaths.set(model.name, outPath);
            if (modelsWithInput.has(model.name)) modelOutPaths.set(`${model.name}Input`, outPath);
            if (modelsWithOutput.has(model.name)) modelOutPaths.set(`${model.name}Output`, outPath);
        }
    }

    for (const { ast, outPath } of entries) {
        const refs = collectContractRootRefs(ast, modelMap);
        const ownNames = new Set(ast.models.map(m => m.name));
        const fingerprint = hashFingerprint({
            kind: 'zod',
            v: TYPESCRIPT_CODEGEN_VERSION,
            outPath,
            root: ast,
            outPathSlice: sliceOutPathMap(refs, modelOutPaths, modelsWithInput, modelsWithOutput),
            modelsWithInput: sliceModelSet(refs, ownNames, modelsWithInput),
            modelsWithOutput: sliceModelSet(refs, ownNames, modelsWithOutput),
            sub: subConfigKey,
        });
        units.push({
            key: `zod::${outPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: outPath,
                    content: generateContract(ast, { modelOutPaths, currentOutPath: outPath, modelsWithInput, modelsWithOutput }),
                },
            ],
        });
    }
}

// ─── Plain types sub-generator ─────────────────────────────────────────────

function collectTypesOutput(
    config: TypesConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    units: IncrementalUnit[],
): void {
    const typesBase = resolve(rootDir, config.baseDir ?? '.');
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const commonRoot = commonDir(allFiles, rootDir);
    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const modelsWithOutput = inputs.modelsWithOutput as Set<string>;
    const modelMap = buildModelMap(inputs.contractRoots);
    const subConfigKey = stableSubConfig(config);

    const modelOutPaths = new Map<string, string>();
    const entries: { ast: ContractRootNode; outPath: string }[] = [];
    for (const ast of inputs.contractRoots) {
        const outPath = computeContractOutPath(ast.file, typesBase, config.output, '.types.ts', commonRoot, ast.meta);
        entries.push({ ast, outPath });
        for (const model of ast.models) {
            modelOutPaths.set(model.name, outPath);
            if (modelsWithInput.has(model.name)) modelOutPaths.set(`${model.name}Input`, outPath);
            if (modelsWithOutput.has(model.name)) modelOutPaths.set(`${model.name}Output`, outPath);
        }
    }

    for (const { ast, outPath } of entries) {
        const refs = collectContractRootRefs(ast, modelMap);
        const ownNames = new Set(ast.models.map(m => m.name));
        const fingerprint = hashFingerprint({
            kind: 'plain-types',
            v: TYPESCRIPT_CODEGEN_VERSION,
            outPath,
            root: ast,
            outPathSlice: sliceOutPathMap(refs, modelOutPaths, modelsWithInput, modelsWithOutput),
            modelsWithInput: sliceModelSet(refs, ownNames, modelsWithInput),
            modelsWithOutput: sliceModelSet(refs, ownNames, modelsWithOutput),
            sub: subConfigKey,
        });
        units.push({
            key: `plain-types::${outPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: outPath,
                    content: generatePlainTypes(ast, { modelOutPaths, currentOutPath: outPath, modelsWithInput, modelsWithOutput }),
                },
            ],
        });
    }
}

// ─── Manifest IO + cleanup ─────────────────────────────────────────────────

function readManifest(manifestPath: string): IncrementalManifest {
    if (!existsSync(manifestPath)) return emptyIncrementalManifest(TYPESCRIPT_CODEGEN_VERSION);
    try {
        return parseIncrementalManifest(readFileSync(manifestPath, 'utf-8'));
    } catch {
        return emptyIncrementalManifest(TYPESCRIPT_CODEGEN_VERSION);
    }
}

function deleteStalePaths(absPaths: string[]): void {
    if (absPaths.length === 0) return;
    const removedDirs = new Set<string>();
    for (const abs of absPaths) {
        if (existsSync(abs)) {
            rmSync(abs, { force: true });
            removedDirs.add(dirname(abs));
        }
    }
    // Walk up affected dirs and remove if empty. Bounded — stops at filesystem root or first non-empty dir.
    for (const dir of removedDirs) {
        let current = dir;
        while (current.length > 1) {
            try {
                if (readdirSync(current).length === 0) {
                    rmdirSync(current);
                    current = dirname(current);
                } else {
                    break;
                }
            } catch {
                break;
            }
        }
    }
}

/** Stringify a sub-config so it can participate in fingerprints. JSON.stringify gives stable output for typical config shapes. */
function stableSubConfig(config: unknown): string {
    return JSON.stringify(config ?? null);
}
