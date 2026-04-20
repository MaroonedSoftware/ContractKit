import { resolve, join, relative, dirname, basename } from 'node:path';
import { generateContract } from './codegen-contract.js';
import { generateOp } from './codegen-operation.js';
import type { ContractKitPlugin } from '@contractkit/core';
import {
    generateSdk,
    generateSdkOptions,
    generateSdkAggregator,
    deriveClientClassName,
    deriveClientPropertyName,
    hasPublicOperations,
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
    /**
     * When true, `output.types` emits Zod schema files (via `generateContract`).
     * When false/omitted, `output.types` emits plain TypeScript interfaces.
     */
    zod?: boolean;
    output?: {
        /** Path template for Koa router files. Supports {filename}, {dir}, {area}. Default: `{filename}.router.ts`. */
        routes?: string;
        /**
         * Path template for type/schema files. Supports {filename}, {dir}, {area}.
         * Generates Zod schemas when `zod: true`, otherwise plain TypeScript interfaces.
         */
        types?: string;
    };
    /** Import path template for service implementations. Supports {module}. */
    servicePathTemplate?: string;
}

export interface SdkConfig {
    /** Directory (relative to rootDir) where SDK files are written. Default: rootDir. */
    baseDir?: string;
    /** Name used for the aggregator SDK class (e.g. "homegrown" → `HomegrownSdk`). */
    name?: string;
    /**
     * When true, `output.types` emits Zod schema files (via `generateContract`).
     * When false/omitted, `output.types` emits plain TypeScript interfaces.
     */
    zod?: boolean;
    output?: {
        /** Path template for the SDK aggregator file. Supports {name}. Default: `sdk.ts`. */
        sdk?: string;
        /** Path template for SDK type files. Supports {filename}, {dir}, {area}. */
        types?: string;
        /** Path template for client class files. Supports {filename}, {dir}, {area}. */
        clients?: string;
    };
}

export interface ZodConfig {
    /** Directory (relative to rootDir) where Zod schema files are written. Default: rootDir. */
    baseDir?: string;
    /** Output path template. Supports {filename}, {dir}. Default: `{filename}.schema.ts` alongside source. */
    output?: string;
}

export interface TypesConfig {
    /** Directory (relative to rootDir) where plain TypeScript type files are written. Default: rootDir. */
    baseDir?: string;
    /** Output path template. Supports {filename}, {dir}. Default: `{filename}.types.ts` alongside source. */
    output?: string;
}

export interface TypescriptPluginConfig {
    /** Generate Koa router files from `operation` declarations. */
    server?: ServerConfig;
    /** Generate TypeScript SDK client files from `operation` declarations. */
    sdk?: SdkConfig;
    /** Generate Zod schema files from `contract` declarations. */
    zod?: ZodConfig;
    /** Generate plain TypeScript interface/type files from `contract` declarations (no Zod runtime). */
    types?: TypesConfig;
}

// ─── Server generation ─────────────────────────────────────────────────────

function runServerGeneration(
    config: ServerConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    emitFile: (outPath: string, content: string) => void,
): void {
    const serverBase = resolve(rootDir, config.baseDir ?? '.');
    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const commonRoot = commonDir(allFiles, rootDir);

    // ── Types / Zod output ──
    // When output.types is configured we generate type files ourselves and build a
    // local modelOutPaths map so the router generator can resolve import paths.
    let serverModelOutPaths = new Map<string, string>();

    if (config.output?.types) {
        serverModelOutPaths = new Map();

        // Pass 1: register all model → outPath entries before generating content,
        // so cross-file type refs resolve correctly.
        const typeEntries: { ast: typeof inputs.contractRoots[number]; typeOutPath: string }[] = [];
        for (const ast of inputs.contractRoots) {
            const typeOutPath = computeContractOutPath(ast.file, serverBase, config.output.types, '.ts', commonRoot, ast.meta);
            typeEntries.push({ ast, typeOutPath });
            for (const model of ast.models) {
                serverModelOutPaths.set(model.name, typeOutPath);
                if (modelsWithInput.has(model.name)) {
                    serverModelOutPaths.set(`${model.name}Input`, typeOutPath);
                }
            }
        }

        // Pass 2: emit type files.
        for (const { ast, typeOutPath } of typeEntries) {
            const ctx = { modelOutPaths: serverModelOutPaths, currentOutPath: typeOutPath, modelsWithInput };
            const content = config.zod
                ? generateContract(ast, ctx)
                : generatePlainTypes(ast, ctx);
            emitFile(typeOutPath, content);
        }
    }

    // ── Routes output ──
    for (const ast of inputs.opRoots) {
        const outPath = computeOpOutPath(ast.file, serverBase, config.output?.routes, '.router.ts', commonRoot, ast.meta);
        const content = generateOp(ast, {
            servicePathTemplate: config.servicePathTemplate,
            outPath,
            modelOutPaths: serverModelOutPaths,
            modelsWithInput,
        });
        emitFile(outPath, content);
    }
}

// ─── SDK generation ────────────────────────────────────────────────────────

function runSdkGeneration(
    config: SdkConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    emitFile: (outPath: string, content: string) => void,
): void {
    const sdkBase = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
    const sdkName = config.name;
    const sdkOutput = config.output?.sdk;
    const sdkEntryPath = sdkOutput
        ? join(sdkBase, TEMPLATE_VAR_RE.test(sdkOutput) ? resolveTemplate(sdkOutput, { name: sdkName ?? 'sdk' }) : sdkOutput)
        : join(sdkBase, 'sdk.ts');
    const sdkOptionsPath = join(dirname(sdkEntryPath), 'sdk-options.ts');

    const modelsWithInput = inputs.modelsWithInput as Set<string>;
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const ckCommonRoot = commonDir(allFiles, rootDir);

    let sdkModelOutPaths = new Map<string, string>();
    const sdkTypePaths: string[] = [];
    const sdkClientInfos: { outPath: string; className: string; propertyName: string }[] = [];

    // ── SDK types ──
    if (config.output?.types) {
        sdkModelOutPaths = new Map<string, string>();
        const publicTypes = computePubliclyReachableTypes(inputs.opRoots, inputs.contractRoots, modelsWithInput);

        const sdkContractEntries: { ast: typeof inputs.contractRoots[number]; typeOutPath: string }[] = [];
        for (const ast of inputs.contractRoots) {
            const typeOutPath = computeSdkTypeOutPath(ast.file, sdkBase, config.output.types, ckCommonRoot, ast.meta);
            if (!typeOutPath) continue;
            if (publicTypes !== null && !ast.models.some(m => publicTypes.has(m.name))) continue;
            sdkTypePaths.push(typeOutPath);
            sdkContractEntries.push({ ast, typeOutPath });
            for (const model of ast.models) {
                sdkModelOutPaths.set(model.name, typeOutPath);
                if (modelsWithInput.has(model.name)) sdkModelOutPaths.set(`${model.name}Input`, typeOutPath);
            }
        }

        for (const { ast, typeOutPath } of sdkContractEntries) {
            let content: string;
            if (config.zod) {
                content = generateContract(ast, {
                    modelOutPaths: sdkModelOutPaths,
                    currentOutPath: typeOutPath,
                    modelsWithInput,
                });
            } else {
                let rel = relative(dirname(typeOutPath), sdkOptionsPath).replace(/\.ts$/, '.js');
                if (!rel.startsWith('.')) rel = './' + rel;
                content = generatePlainTypes(ast, {
                    modelOutPaths: sdkModelOutPaths,
                    currentOutPath: typeOutPath,
                    modelsWithInput,
                    jsonValueImportPath: rel,
                });
            }
            emitFile(typeOutPath, content);
        }
    }

    // ── SDK clients ──
    if (config.output?.clients) {
        for (const ast of inputs.opRoots) {
            const sdkOutPath = computeSdkOutPath(ast.file, sdkBase, config.output.clients, ckCommonRoot, ast.meta);
            if (!sdkOutPath || !hasPublicOperations(ast)) continue;
            sdkClientInfos.push({
                outPath: sdkOutPath,
                className: deriveClientClassName(ast.file),
                propertyName: deriveClientPropertyName(ast.file),
            });
            emitFile(sdkOutPath, generateSdk(ast, {
                typeImportPathTemplate: undefined,
                outPath: sdkOutPath,
                modelOutPaths: sdkModelOutPaths,
                sdkOptionsPath,
                modelsWithInput,
            }));
        }
    }

    // ── sdk-options.ts ──
    emitFile(sdkOptionsPath, generateSdkOptions());

    // ── sdk.ts aggregator ──
    if (sdkClientInfos.length > 0) {
        const sdkEntryDir = dirname(sdkEntryPath);
        const clients = sdkClientInfos.map(c => {
            let rel = relative(sdkEntryDir, c.outPath).replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            return { className: c.className, propertyName: c.propertyName, importPath: rel };
        });
        const sdkOptionsRel = relative(sdkEntryDir, sdkOptionsPath).replace(/\.ts$/, '.js');
        const sdkClassName = sdkName
            ? sdkName.split(/[-._\s]+/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Sdk'
            : 'Sdk';
        emitFile(sdkEntryPath, generateSdkAggregator(
            clients,
            sdkOptionsRel.startsWith('.') ? sdkOptionsRel : './' + sdkOptionsRel,
            sdkClassName,
        ));
    }

    // ── Barrel files ──
    const sdkSrcDir = dirname(sdkEntryPath);
    const sdkTypeBarrels = generateBarrelFiles(sdkTypePaths);
    for (const barrel of sdkTypeBarrels) emitFile(barrel.outPath, barrel.content);

    const rootExports: string[] = [
        `export * from './${basename(sdkOptionsPath).replace(/\.ts$/, '.js')}';`,
    ];
    if (sdkClientInfos.length > 0) {
        rootExports.push(`export * from './${basename(sdkEntryPath).replace(/\.ts$/, '.js')}';`);
    }
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
    emitFile(join(sdkSrcDir, 'index.ts'), `// Auto-generated barrel file\n${rootExports.sort().join('\n')}\n`);
}

// ─── Zod generation ────────────────────────────────────────────────────────

function runZodGeneration(
    config: ZodConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    emitFile: (outPath: string, content: string) => void,
): void {
    const zodBase = resolve(rootDir, config.baseDir ?? '.');
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const commonRoot = commonDir(allFiles, rootDir);
    const modelsWithInput = inputs.modelsWithInput as Set<string>;

    // Pre-pass: register all model → outPath before generating, so cross-file imports resolve.
    const modelOutPaths = new Map<string, string>();
    const entries: { ast: typeof inputs.contractRoots[number]; outPath: string }[] = [];
    for (const ast of inputs.contractRoots) {
        const outPath = computeContractOutPath(ast.file, zodBase, config.output, '.schema.ts', commonRoot, ast.meta);
        entries.push({ ast, outPath });
        for (const model of ast.models) {
            modelOutPaths.set(model.name, outPath);
            if (modelsWithInput.has(model.name)) modelOutPaths.set(`${model.name}Input`, outPath);
        }
    }

    for (const { ast, outPath } of entries) {
        const content = generateContract(ast, {
            modelOutPaths,
            currentOutPath: outPath,
            modelsWithInput,
        });
        emitFile(outPath, content);
    }
}

// ─── Types generation ──────────────────────────────────────────────────────

function runTypesGeneration(
    config: TypesConfig,
    rootDir: string,
    inputs: Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0],
    emitFile: (outPath: string, content: string) => void,
): void {
    const typesBase = resolve(rootDir, config.baseDir ?? '.');
    const allFiles = [...inputs.contractRoots.map(r => r.file), ...inputs.opRoots.map(r => r.file)];
    const commonRoot = commonDir(allFiles, rootDir);
    const modelsWithInput = inputs.modelsWithInput as Set<string>;

    // Pre-pass: register all model → outPath before generating.
    const modelOutPaths = new Map<string, string>();
    const entries: { ast: typeof inputs.contractRoots[number]; outPath: string }[] = [];
    for (const ast of inputs.contractRoots) {
        const outPath = computeContractOutPath(ast.file, typesBase, config.output, '.types.ts', commonRoot, ast.meta);
        entries.push({ ast, outPath });
        for (const model of ast.models) {
            modelOutPaths.set(model.name, outPath);
            if (modelsWithInput.has(model.name)) modelOutPaths.set(`${model.name}Input`, outPath);
        }
    }

    for (const { ast, outPath } of entries) {
        const content = generatePlainTypes(ast, {
            modelOutPaths,
            currentOutPath: outPath,
            modelsWithInput,
        });
        emitFile(outPath, content);
    }
}

// ─── Combined plugin ────────────────────────────────────────────────────────

const plugin: ContractKitPlugin = {
    name: 'typescript',
    cacheKey: 'typescript',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as TypescriptPluginConfig;

        if (config.server) {
            runServerGeneration(config.server, ctx.rootDir, inputs, ctx.emitFile.bind(ctx));
        }
        if (config.sdk) {
            runSdkGeneration(config.sdk, ctx.rootDir, inputs, ctx.emitFile.bind(ctx));
        }
        if (config.zod) {
            runZodGeneration(config.zod, ctx.rootDir, inputs, ctx.emitFile.bind(ctx));
        }
        if (config.types) {
            runTypesGeneration(config.types, ctx.rootDir, inputs, ctx.emitFile.bind(ctx));
        }
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createTypescriptPlugin(config: TypescriptPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'typescript',
        cacheKey: `typescript:${JSON.stringify(config)}`,
        async generateTargets(inputs, ctx) {
            if (config.server) {
                runServerGeneration(config.server, rootDir, inputs, ctx.emitFile.bind(ctx));
            }
            if (config.sdk) {
                runSdkGeneration(config.sdk, rootDir, inputs, ctx.emitFile.bind(ctx));
            }
            if (config.zod) {
                runZodGeneration(config.zod, rootDir, inputs, ctx.emitFile.bind(ctx));
            }
            if (config.types) {
                runTypesGeneration(config.types, rootDir, inputs, ctx.emitFile.bind(ctx));
            }
        },
    };
}

