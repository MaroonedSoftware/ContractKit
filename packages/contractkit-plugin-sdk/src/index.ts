import { resolve, join, relative, dirname, basename } from 'node:path';
import {
    generateSdk,
    generateSdkOptions,
    generateSdkAggregator,
    deriveClientClassName,
    deriveClientPropertyName,
    hasPublicOperations,
} from './codegen-sdk.js';
import { generatePlainTypes } from './codegen-plain-types.js';
import type { ContractKitPlugin } from '@maroonedsoftware/contractkit';
import {
    commonDir,
    computeSdkOutPath,
    computeSdkTypeOutPath,
    generateBarrelFiles,
    computePubliclyReachableTypes,
    resolveTemplate,
    TEMPLATE_VAR_RE,
} from './path-utils.js';

export interface SdkPluginConfig {
    baseDir?: string;
    name?: string;
    output?: {
        sdk?: string;
        types?: string;
        clients?: string;
    };
}

// ─── Shared generateTargets implementation ─────────────────────────────────

function buildGenerateTargets(config: SdkPluginConfig, rootDir: string): NonNullable<ContractKitPlugin['generateTargets']> {
    const sdkBase = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
    const sdkName = config.name;
    const sdkOutput = config.output?.sdk;
    const sdkEntryPath = sdkOutput
        ? join(sdkBase, TEMPLATE_VAR_RE.test(sdkOutput) ? resolveTemplate(sdkOutput, { name: sdkName ?? 'sdk' }) : sdkOutput)
        : join(sdkBase, 'sdk.ts');
    const sdkOptionsPath = join(dirname(sdkEntryPath), 'sdk-options.ts');

    return async function ({ contractRoots, opRoots, modelOutPaths, modelsWithInput: _modelsWithInput }, ctx) {
        const modelsWithInput = _modelsWithInput as Set<string>;
        const allFiles = [...contractRoots.map(r => r.file), ...opRoots.map(r => r.file)];
        const ckCommonRoot = commonDir(allFiles, ctx.rootDir);

        let sdkModelOutPaths = modelOutPaths as Map<string, string>;
        const sdkTypePaths: string[] = [];
        const sdkClientInfos: { outPath: string; className: string; propertyName: string }[] = [];

        // ── SDK types ──
        if (config.output?.types) {
            sdkModelOutPaths = new Map<string, string>();
            const publicTypes = computePubliclyReachableTypes(opRoots, contractRoots, modelsWithInput);

            // Pass 1: register all model→outPath entries
            const sdkDtoEntries: { ast: typeof contractRoots[number]; typeOutPath: string }[] = [];
            for (const ast of contractRoots) {
                const typeOutPath = computeSdkTypeOutPath(ast.file, sdkBase, config.output.types, ckCommonRoot, ast.meta);
                if (!typeOutPath) continue;
                if (publicTypes !== null && !ast.models.some(m => publicTypes.has(m.name))) continue;
                sdkTypePaths.push(typeOutPath);
                sdkDtoEntries.push({ ast, typeOutPath });
                for (const model of ast.models) {
                    sdkModelOutPaths.set(model.name, typeOutPath);
                    if (modelsWithInput.has(model.name)) sdkModelOutPaths.set(`${model.name}Input`, typeOutPath);
                }
            }

            // Pass 2: generate type files
            for (const { ast, typeOutPath } of sdkDtoEntries) {
                let rel = relative(dirname(typeOutPath), sdkOptionsPath).replace(/\.ts$/, '.js');
                if (!rel.startsWith('.')) rel = './' + rel;
                ctx.emitFile(typeOutPath, generatePlainTypes(ast, {
                    modelOutPaths: sdkModelOutPaths,
                    currentOutPath: typeOutPath,
                    modelsWithInput,
                    jsonValueImportPath: rel,
                }));
            }
        }

        // ── SDK clients ──
        if (config.output?.clients) {
            for (const ast of opRoots) {
                const sdkOutPath = computeSdkOutPath(ast.file, sdkBase, config.output.clients, ckCommonRoot, ast.meta);
                if (!sdkOutPath || !hasPublicOperations(ast)) continue;
                sdkClientInfos.push({
                    outPath: sdkOutPath,
                    className: deriveClientClassName(ast.file),
                    propertyName: deriveClientPropertyName(ast.file),
                });
                ctx.emitFile(sdkOutPath, generateSdk(ast, {
                    typeImportPathTemplate: undefined,
                    outPath: sdkOutPath,
                    modelOutPaths: sdkModelOutPaths,
                    sdkOptionsPath,
                    modelsWithInput,
                }));
            }
        }

        // ── sdk-options.ts ──
        ctx.emitFile(sdkOptionsPath, generateSdkOptions());

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
            const aggregatorContent = generateSdkAggregator(
                clients,
                sdkOptionsRel.startsWith('.') ? sdkOptionsRel : './' + sdkOptionsRel,
                sdkClassName,
            );
            ctx.emitFile(sdkEntryPath, aggregatorContent);
        }

        // ── Barrel files ──
        const sdkSrcDir = dirname(sdkEntryPath);
        const sdkTypeBarrels = generateBarrelFiles(sdkTypePaths);
        for (const barrel of sdkTypeBarrels) ctx.emitFile(barrel.outPath, barrel.content);

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
        ctx.emitFile(join(sdkSrcDir, 'index.ts'), `// Auto-generated barrel file\n${rootExports.sort().join('\n')}\n`);
    };
}

// ─── Default export: loaded via plugins array, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'sdk',
    cacheKey: 'sdk',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as SdkPluginConfig;
        await buildGenerateTargets(config, ctx.rootDir)(inputs, ctx);
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createSdkPlugin(config: SdkPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'sdk',
        cacheKey: `sdk:${JSON.stringify(config)}`,
        generateTargets: buildGenerateTargets(config, rootDir),
    };
}
