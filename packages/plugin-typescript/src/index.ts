import { resolve, join, relative, dirname, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, rmdirSync } from 'node:fs';
import { generateContract, rootNeedsScalar } from './codegen-contract.js';
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
    serializeIncrementalManifest,
    hashFingerprint,
    collectTransitiveModelRefs,
    collectTypeRefs,
    computeModelsWithCaseTransform,
    computeModelsWithScalar,
} from '@contractkit/core';
import {
    generateSdk,
    generateSdkOptions,
    generateSdkAggregator,
    generateAreaClient,
    deriveClientClassName,
    deriveClientPropertyName,
    deriveAreaClientClassName,
    deriveAreaPropertyName,
    deriveSubareaClientClassName,
    deriveSubareaPropertyName,
    getAreaSubarea,
    hasPublicOperations,
    generateSdkPackageJson,
    generateSdkTsconfig,
    type SdkClientInfo,
    type SdkAreaInfo,
    type SdkScaffoldDeps,
} from './codegen-sdk.js';
import { generatePlainTypes } from './codegen-plain-types.js';
import { DEFAULT_REVIVABLE_SCALARS } from './codegen-revive.js';
import { generateMcpFile, generateMcpAggregator, generateMcpRouter, hasMcpOperations, deriveMcpRegisterFnName } from './codegen-mcp.js';
import {
    TEMPLATE_VAR_RE,
    TEMPLATE_VAR_RE_G,
    resolveTemplate,
    commonDir,
    computeOpOutPath,
    computeContractOutPath,
    computeSdkOutPath,
    computeSdkAreaClientOutPath,
    computeSdkTypeOutPath,
    generateBarrelFiles,
    computePubliclyReachableTypes,
} from './path-utils.js';

// ─── Sub-config interfaces ─────────────────────────────────────────────────

/** Koa server output: routers, and the type or Zod schema files they import. */
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
    /**
     * When true, each handler re-parses the service result through its declared response schema
     * before writing `ctx.body`, and writes the parsed value. Requires `zod: true` — without it
     * `output.types` emits plain interfaces, which are types with no runtime schema value.
     *
     * A body that transitively references a model with `format(input=...)`/`format(output=...)`, and
     * a status whose several mimes carry different body types, are left unvalidated. Default false.
     */
    validateResponses?: boolean;
}

/** TypeScript SDK client output: the client class, per-area operation clients, and their types. */
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
    /**
     * Emit a starter `package.json` and `tsconfig.json` at the SDK `baseDir` so the
     * generated output is a buildable, publishable package on its own. Opt-in and
     * write-once: the files are created only when absent and are never overwritten or
     * cleaned up on later builds, so any edits you make to them are preserved.
     * Dependency ranges are derived from the contracts (always `zod` when `zod: true`;
     * `luxon` when any covered model uses a date/time/datetime/duration/interval scalar;
     * `decimal.js` when any uses a decimal).
     */
    scaffold?: boolean;
}

/** Standalone Zod schema output, independent of the server and SDK sub-generators. */
export interface ZodConfig {
    baseDir?: string;
    output?: string;
}

/** Standalone plain TypeScript type output, independent of the server and SDK sub-generators. */
export interface TypesConfig {
    baseDir?: string;
    output?: string;
    /**
     * Runtime the emitted types describe. Affects scalars whose TypeScript type is runtime-specific:
     * `binary` renders as `Buffer` for `'server'` and `Blob` for `'client'`. Default `'client'`.
     * The `server` and `sdk` sub-generators set this themselves.
     */
    target?: 'client' | 'server';
}

/** MCP tool output: per-op-file handlers, the aggregator, and the optional POST route. */
export interface McpConfig {
    /** Directory (relative to rootDir) where MCP files are written. Default: rootDir. */
    baseDir?: string;
    output?: {
        /** Path template for per-op-file tool handlers. Supports {filename}, {dir}, {area}. Default `{filename}.mcp.ts`. */
        tools?: string;
        /** Path (or template) for the aggregator that assembles the McpToolHandlerMap. Default `mcp.tools.ts`. */
        index?: string;
        /** Path (or template) for the optional POST /mcp route file. Default `mcp.router.ts`. */
        router?: string;
        /**
         * Path template for the model **Zod schema** files the tools import (for arg validation and
         * `z.toJSONSchema`). When omitted, falls back to the `server` sub-config's `output.types`
         * (if `server.zod`) or the `zod` sub-config's output. Tools require Zod schemas, not plain types.
         */
        types?: string;
    };
    /** Emit the `mcp.router.ts` route boilerplate. Default true. */
    emitRouter?: boolean;
    /** Mount path used in the emitted router. Default `/mcp`. */
    path?: string;
    /** Import path template for service implementations (same semantics as ServerConfig). */
    servicePathTemplate?: string;
    /** Whether to expose operations marked `internal` as MCP tools. Default false. */
    includeInternal?: boolean;
}

/** Top-level plugin config. Each sub-config that is present enables its sub-generator. */
export interface TypescriptPluginConfig {
    server?: ServerConfig;
    sdk?: SdkConfig;
    zod?: ZodConfig;
    types?: TypesConfig;
    mcp?: McpConfig;
}

// ─── Caching constants ─────────────────────────────────────────────────────

/** Bumped when the codegen output shape changes in a way that should bust every per-file fingerprint. */
export const TYPESCRIPT_CODEGEN_VERSION = '2';

// The taint set is `DEFAULT_REVIVABLE_SCALARS` rather than decimal alone, which is what makes a
// temporal field a real Luxon object in an SDK client rather than a string wearing a `DateTime`
// type. It also feeds every `hashFingerprint` that already slices this set, so a model gaining a
// `datetime` in another `.ck` file invalidates this file's cached output with no extra plumbing.

/** Filename for the persisted TypeScript manifest under the CLI cache directory. */
const CACHE_MANIFEST_FILENAME = 'typescript-manifest.json';

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

/** Reject config combinations that would generate code that cannot compile or cannot run. */
function assertValidConfig(config: TypescriptPluginConfig): void {
    if (config.server?.validateResponses && !config.server.zod) {
        throw new Error(
            'plugin-typescript: server.validateResponses requires server.zod: true — without it output.types emits plain TypeScript interfaces, which are types with no runtime schema value for the router to validate against.',
        );
    }
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
    assertValidConfig(config);
    const manifestPath = resolve(ctx.cacheDir, CACHE_MANIFEST_FILENAME);
    const prevManifest: IncrementalManifest = ctx.cacheEnabled ? readManifest(manifestPath) : emptyIncrementalManifest(TYPESCRIPT_CODEGEN_VERSION);

    const units: IncrementalUnit[] = [];
    const globalFiles: IncrementalOutputFile[] = [];

    if (config.server) collectServerOutput(config.server, rootDir, inputs, units);
    if (config.sdk) collectSdkOutput(config.sdk, rootDir, inputs, units, globalFiles);
    if (config.zod) collectZodOutput(config.zod, rootDir, inputs, units);
    if (config.types) collectTypesOutput(config.types, rootDir, inputs, units);
    if (config.mcp) collectMcpOutput(config.mcp, config, rootDir, inputs, units, globalFiles);

    const result = runIncrementalCodegen({
        codegenVersion: TYPESCRIPT_CODEGEN_VERSION,
        prevManifest,
        globalFiles,
        units,
        // Paths are absolute, so existsSync works directly.
        fileExists: existsSync,
    });

    deleteStalePaths(result.deletedPaths);

    const unresolved = new Set<string>();
    for (const { relativePath, content, ifAbsent } of result.filesToWrite) {
        for (const [, key] of relativePath.matchAll(TEMPLATE_VAR_RE_G)) unresolved.add(`${key}::${relativePath}`);
        ctx.emitFile(relativePath, content, ifAbsent ? { ifAbsent: true } : undefined);
    }
    // `resolveTemplate` leaves an unknown `{key}` in place, which then joins straight into the
    // output path — producing a literal `{area}` directory rather than an error. `assertWithinBase`
    // does not catch it, since the path is inside the base, just wrong. Checked here rather than
    // threaded down through five path helpers: every output path passes through this one funnel,
    // whichever helper built it.
    for (const entry of [...unresolved].sort()) {
        const [key, outPath] = entry.split('::');
        ctx.warn?.(
            `Output path template variable {${key}} has no value, so '${outPath}' contains it literally. ` +
                `Declare it in the source file's 'options { keys { ${key}: ... } }' block, or remove it from the path template.`,
        );
    }

    writeManifest(manifestPath, result.manifest);
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
                for (const body of resp.bodies) seeds.push(body.bodyType);
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
    // Not `modelsWithOutput`: that set seeds only from `format(output=...)`, because only that case
    // needs an `Output` type alias. A `format(input=...)`-only model is just as untouchable for
    // response validation — its schema's input casing is not what the service hands back.
    const modelsWithTransform = computeModelsWithCaseTransform(inputs.contractRoots.flatMap(r => r.models));
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
                    // These types are consumed by Koa handlers, so `binary` is a Buffer, not a Blob.
                    target: 'server' as const,
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
            // Not covered by `sub`: adding `format(input=snake)` to a *different* .ck file changes
            // this router's output with no change to `root` or the config.
            modelsWithTransform: sliceModelSet(refs, new Set(), modelsWithTransform),
            validateResponses: config.validateResponses ?? false,
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
                        modelsWithTransform,
                        includeInternal: config.includeInternal,
                        validateResponses: config.validateResponses,
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
    // Computed across every contract root, not per file: one decimal below a model taints it, and
    // the reference that reaches it may live in another .ck file entirely.
    const modelsWithDecimal = computeModelsWithScalar(inputs.contractRoots.flatMap(r => r.models), DEFAULT_REVIVABLE_SCALARS);
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
            // Not covered by `root`: adding a decimal to a model in a *different* .ck file changes
            // this file's revivers with no change to `root` or the config.
            modelsWithDecimal: sliceModelSet(refs, ownNames, modelsWithDecimal),
            sdkOptionsPath,
            sub: subConfigKey,
        });
        units.push({
            key: `sdk-types::${typeOutPath}`,
            fingerprint,
            render: () => {
                let content: string;
                // `emitRevivers` is set for SDK type files only: a server handler receives decimals
                // already parsed by `_ZodDecimal`, so it has nothing to rehydrate.
                if (config.zod) {
                    content = generateContract(ast, {
                        modelOutPaths: sdkModelOutPaths,
                        currentOutPath: typeOutPath,
                        modelsWithInput,
                        modelsWithOutput,
                        modelsWithDecimal,
                        emitRevivers: true,
                        // An SDK client runs in a browser as readily as in Node, and its scaffold
                        // declares no `@types/node`.
                        target: 'client',
                    });
                } else {
                    let rel = relative(dirname(typeOutPath), sdkOptionsPath).replace(/\.ts$/, '.js');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    content = generatePlainTypes(ast, {
                        modelOutPaths: sdkModelOutPaths,
                        currentOutPath: typeOutPath,
                        modelsWithInput,
                        modelsWithOutput,
                        modelsWithDecimal,
                        emitRevivers: true,
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
                    modelsWithDecimal: sliceModelSet(refs, new Set(), modelsWithDecimal),
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
                                modelsWithDecimal,
                                modelMap,
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
                modelsWithDecimal: sliceModelSet(refs, new Set(), modelsWithDecimal),
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
                            modelsWithDecimal,
                            modelMap,
                            includeInternal: config.includeInternal,
                        }),
                    },
                ],
            });
        }
    }

    // ── Global files: sdk-options, aggregator, barrels, root index ──
    // sdk-options.ts is a constant; the aggregator is small (just imports + a wrapper class)
    // and depends on the cross-cutting client list, so it's cheap to regenerate every run.
    // Per-area `<area>.client.ts` files are cached as their own units below.
    globalFiles.push({ relativePath: sdkOptionsPath, content: generateSdkOptions() });

    const hasAnything = sdkClientInfos.length > 0 || areaBuckets.size > 0;
    const areaClientOutPaths = new Map<string, string>(); // area → absolute outPath of <area>.client.ts
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

        const toClientImport = (sourceDir: string, info: { outPath: string; className: string; propertyName: string }): SdkClientInfo => {
            let rel = relative(sourceDir, info.outPath).replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            return { className: info.className, propertyName: info.propertyName, importPath: rel };
        };

        const topLevelClients: SdkClientInfo[] = topLevelEntries.map(e =>
            toClientImport(sdkEntryDir, {
                outPath: e.outPath,
                className: deriveClientClassName(e.ast.file),
                propertyName: deriveClientPropertyName(e.ast.file),
            }),
        );

        // ── Per-area `<area>.client.ts` units ──
        const areaInfos: SdkAreaInfo[] = [];
        const sortedAreas = [...areaBuckets.entries()].sort(([a], [b]) => a.localeCompare(b));
        for (const [area, bucket] of sortedAreas) {
            const areaClientOutPath = computeSdkAreaClientOutPath(area, sdkBase, config.output!.clients);
            areaClientOutPaths.set(area, areaClientOutPath);
            const areaClassName = deriveAreaClientClassName(area);
            const areaPropertyName = deriveAreaPropertyName(area);
            sdkClientInfos.push({ outPath: areaClientOutPath, className: areaClassName, propertyName: areaPropertyName });

            const subareaClients = bucket.leaves
                .sort((a, b) => a.subarea.localeCompare(b.subarea))
                .map(l => ({
                    propertyName: deriveSubareaPropertyName(l.subarea),
                    client: toClientImport(dirname(areaClientOutPath), {
                        outPath: l.outPath,
                        className: deriveSubareaClientClassName(area, l.subarea),
                        propertyName: deriveSubareaPropertyName(l.subarea),
                    }),
                }));

            // Fingerprint covers every input the area client depends on:
            //  - all inline roots (full AST)
            //  - subarea client metadata (className / propertyName / import path)
            //  - the modelOutPaths slice for refs across all inline roots
            //  - modelsWithInput/Output slices
            const allInlineRefs = new Set<string>();
            for (const r of bucket.inlineRoots) {
                for (const ref of collectOpRootRefs(r, modelMap)) allInlineRefs.add(ref);
            }
            const fingerprint = hashFingerprint({
                kind: 'sdk-area-client',
                v: TYPESCRIPT_CODEGEN_VERSION,
                outPath: areaClientOutPath,
                area,
                inlineRoots: bucket.inlineRoots,
                subareaClients,
                outPathSlice: sliceOutPathMap(allInlineRefs, sdkModelOutPaths, modelsWithInput, modelsWithOutput),
                modelsWithInput: sliceModelSet(allInlineRefs, new Set(), modelsWithInput),
                modelsWithOutput: sliceModelSet(allInlineRefs, new Set(), modelsWithOutput),
                modelsWithDecimal: sliceModelSet(allInlineRefs, new Set(), modelsWithDecimal),
                sdkOptionsPath,
                includeInternal: config.includeInternal ?? false,
                sub: subConfigKey,
            });

            const inlineFilesForGen = bucket.inlineRoots.map(root => ({
                root,
                codegenOptions: {
                    typeImportPathTemplate: undefined,
                    outPath: areaClientOutPath,
                    modelOutPaths: sdkModelOutPaths,
                    sdkOptionsPath,
                    modelsWithInput,
                    modelsWithOutput,
                    modelsWithDecimal,
                    modelMap,
                    includeInternal: config.includeInternal,
                },
            }));

            units.push({
                key: `sdk-area-client::${areaClientOutPath}`,
                fingerprint,
                render: () => [
                    {
                        relativePath: areaClientOutPath,
                        content: generateAreaClient({
                            area,
                            outPath: areaClientOutPath,
                            inlineFiles: inlineFilesForGen,
                            subareaClients,
                            sdkOptionsPath,
                        }),
                    },
                ],
            });

            areaInfos.push({
                area,
                client: toClientImport(sdkEntryDir, { outPath: areaClientOutPath, className: areaClassName, propertyName: areaPropertyName }),
            });
        }

        globalFiles.push({
            relativePath: sdkEntryPath,
            content: generateSdkAggregator({ topLevelClients, areas: areaInfos, sdkOptionsImportPath, sdkClassName }),
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

    // ── Scaffold files (opt-in, write-once) ──
    // Emitted at the SDK package root with `ifAbsent` so they're created once and
    // then owned by the user. Deps are derived from the contracts actually surfaced
    // into the SDK: zod when schema output is on, luxon when any covered model uses a
    // date/time/datetime/interval scalar.
    if (config.scaffold) {
        const coveredRoots = sdkContractEntries.map(e => e.ast);
        const deps: SdkScaffoldDeps = {
            zod: !!config.zod,
            // `duration` belongs here too: `generateContract` imports `Duration` from luxon for it,
            // so a contract whose only temporal scalar is a duration used to scaffold a package.json
            // with no luxon dependency and fail to compile.
            luxon: coveredRoots.some(r =>
                (['datetime', 'date', 'time', 'duration', 'interval'] as const).some(name => rootNeedsScalar(r, name)),
            ),
            decimal: coveredRoots.some(r => rootNeedsScalar(r, 'decimal')),
        };
        globalFiles.push({
            relativePath: join(sdkBase, 'package.json'),
            content: generateSdkPackageJson({ name: sdkName ?? 'sdk', deps }),
            ifAbsent: true,
        });
        globalFiles.push({
            relativePath: join(sdkBase, 'tsconfig.json'),
            content: generateSdkTsconfig(),
            ifAbsent: true,
        });
    }
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
                    // Server-shaped, which is what this sub-generator has always emitted. The
                    // standalone `zod:` output has no target option of its own; only the SDK's
                    // schemas are client-shaped, and they pass their own target.
                    content: generateContract(ast, { modelOutPaths, currentOutPath: outPath, modelsWithInput, modelsWithOutput, target: 'server' }),
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
                    content: generatePlainTypes(ast, {
                        modelOutPaths,
                        currentOutPath: outPath,
                        modelsWithInput,
                        modelsWithOutput,
                        target: config.target,
                    }),
                },
            ],
        });
    }
}

// ─── MCP sub-generator ─────────────────────────────────────────────────────

/**
 * Resolve where the model **Zod schema** files live so the MCP tools can import them (for arg
 * validation + `z.toJSONSchema`). Precedence: explicit `mcp.output.types` → the `server` sub-config's
 * `output.types` (only when `server.zod`) → the `zod` sub-config's output. Returns an empty map when
 * none resolve (imports then fall back to a colocated `./<name>.js` guess).
 */
function resolveMcpModelOutPaths(
    config: TypescriptPluginConfig,
    rootDir: string,
    contractRoots: readonly ContractRootNode[],
    commonRoot: string,
    modelsWithInput: Set<string>,
    modelsWithOutput: Set<string>,
): Map<string, string> {
    const map = new Map<string, string>();
    let base: string;
    let template: string | undefined;
    let suffix: string;
    if (config.mcp?.output?.types) {
        base = resolve(rootDir, config.mcp.baseDir ?? '.');
        template = config.mcp.output.types;
        suffix = '.ts';
    } else if (config.server?.zod && config.server.output?.types) {
        base = resolve(rootDir, config.server.baseDir ?? '.');
        template = config.server.output.types;
        suffix = '.ts';
    } else if (config.zod) {
        base = resolve(rootDir, config.zod.baseDir ?? '.');
        template = config.zod.output;
        suffix = '.schema.ts';
    } else {
        return map;
    }

    for (const ast of contractRoots) {
        const outPath = computeContractOutPath(ast.file, base, template, suffix, commonRoot, ast.meta);
        for (const model of ast.models) {
            map.set(model.name, outPath);
            if (modelsWithInput.has(model.name)) map.set(`${model.name}Input`, outPath);
            if (modelsWithOutput.has(model.name)) map.set(`${model.name}Output`, outPath);
        }
    }
    return map;
}

function collectMcpOutput(
    config: McpConfig,
    fullConfig: TypescriptPluginConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    units: IncrementalUnit[],
    globalFiles: IncrementalOutputFile[],
): void {
    const mcpBase = resolve(rootDir, config.baseDir ?? '.');
    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const modelsWithOutput = inputs.modelsWithOutput as Set<string>;
    const modelMap = buildModelMap(inputs.contractRoots);
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const commonRoot = commonDir(allFiles, rootDir);
    const subConfigKey = stableSubConfig(config);
    const includeInternal = config.includeInternal ?? false;

    const modelOutPaths = resolveMcpModelOutPaths(fullConfig, rootDir, inputs.contractRoots, commonRoot, modelsWithInput, modelsWithOutput);

    // ── Per-op-root tool-handler units (only files with MCP-exposed ops) ──
    const entries: { outPath: string; registerFn: string }[] = [];
    for (const ast of inputs.opRoots) {
        if (!hasMcpOperations(ast, includeInternal)) continue;
        const outPath = computeOpOutPath(ast.file, mcpBase, config.output?.tools, '.mcp.ts', commonRoot, ast.meta);
        const refs = collectOpRootRefs(ast, modelMap);
        const fingerprint = hashFingerprint({
            kind: 'mcp-tools',
            v: TYPESCRIPT_CODEGEN_VERSION,
            outPath,
            root: ast,
            outPathSlice: sliceOutPathMap(refs, modelOutPaths, modelsWithInput, modelsWithOutput),
            modelsWithInput: sliceModelSet(refs, new Set(), modelsWithInput),
            modelsWithOutput: sliceModelSet(refs, new Set(), modelsWithOutput),
            servicePathTemplate: config.servicePathTemplate ?? null,
            includeInternal,
            sub: subConfigKey,
        });
        units.push({
            key: `mcp-tools::${outPath}`,
            fingerprint,
            render: () => [
                {
                    relativePath: outPath,
                    content: generateMcpFile(ast, {
                        outPath,
                        modelOutPaths,
                        modelsWithInput,
                        modelsWithOutput,
                        servicePathTemplate: config.servicePathTemplate,
                        includeInternal,
                    }),
                },
            ],
        });
        entries.push({ outPath, registerFn: deriveMcpRegisterFnName(ast.file) });
    }

    if (entries.length === 0) return;

    // ── Aggregator (global) ──
    const indexPath = join(mcpBase, config.output?.index ?? 'mcp.tools.ts');
    const aggregatorEntries = entries
        .map(e => {
            let rel = relative(dirname(indexPath), e.outPath).replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            return { registerFn: e.registerFn, importPath: rel };
        })
        .sort((a, b) => a.registerFn.localeCompare(b.registerFn));
    globalFiles.push({ relativePath: indexPath, content: generateMcpAggregator(aggregatorEntries) });

    // ── Router (global, optional) ──
    if (config.emitRouter !== false) {
        const routerPath = join(mcpBase, config.output?.router ?? 'mcp.router.ts');
        globalFiles.push({ relativePath: routerPath, content: generateMcpRouter({ path: config.path }) });
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

/** Write the manifest to `manifestPath`. Creates parent dirs as needed. Errors are swallowed so a broken cache never blocks the build. */
function writeManifest(manifestPath: string, manifest: IncrementalManifest): void {
    try {
        mkdirSync(dirname(manifestPath), { recursive: true });
        writeFileSync(manifestPath, serializeIncrementalManifest(manifest), 'utf-8');
    } catch {
        // best-effort
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
