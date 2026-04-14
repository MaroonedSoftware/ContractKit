#!/usr/bin/env node

// ─── Subcommand dispatch ──────────────────────────────────────────────────
if (process.argv[2] === 'import-openapi') {
    const { runImportOpenApi } = await import('./import-openapi.js');
    await runImportOpenApi();
    process.exit(0);
}

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { glob } from 'glob';
import {
    DiagnosticCollector,
    parseCk,
    decomposeCk,
    generateContract,
    collectTypeRefs,
    validateOp,
    validateRefs,
} from '@maroonedsoftware/contractkit';
import type { ContractCodegenContext, ContractRootNode, OpRootNode, CkRootNode } from '@maroonedsoftware/contractkit';
import { loadConfig, mergeConfig } from './config.js';
import { loadCache, saveCache, computeHash, isFileChanged } from './cache.js';
import { loadPlugins, makePluginContext, computePluginFingerprint, pluginOutputsExist } from './plugin.js';
import { resolveTemplate, includesFilename, commonDir, generateBarrelFiles, TEMPLATE_VAR_RE } from './path-utils.js';
import type { ResolvedConfig } from './config.js';
import type { FileHashMap } from './cache.js';
import type { LoadedPlugin } from './plugin.js';

// ─── Arg parsing ───────────────────────────────────────────────────────────

interface CliArgs {
    config?: string;
    watch: boolean;
    force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
    const args = argv.slice(2);
    let config: string | undefined;
    let watch = false;
    let force = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--config' || arg === '-c') {
            config = args[++i];
        } else if (arg === '--watch' || arg === '-w') {
            watch = true;
        } else if (arg === '--force') {
            force = true;
        }
    }

    return { config, watch, force };
}

// ─── File resolution ───────────────────────────────────────────────────────

async function resolveFiles(patterns: string[], rootDir: string): Promise<string[]> {
    console.log(resolve(rootDir));
    const files: string[] = [];
    for (const pattern of patterns) {
        const matches = await glob(pattern, { absolute: true, cwd: resolve(rootDir) });
        files.push(...matches);
    }
    return [...new Set(files)];
}

// ─── Output path computation ──────────────────────────────────────────────

interface OutPathOptions {
    rootDir: string;
    server: {
        types: { output?: string };
        routes: { output?: string };
    };
}

/** Compute output paths for a .ck file — produces both types and routes outputs. */
function computeCkOutPaths(
    filePath: string,
    opts: OutPathOptions,
    rootDir: string,
    meta: Record<string, string> = {},
): { typesOutPath: string; routesOutPath: string } {
    const baseName = filePath.split('/').pop()!;
    const baseOutDir = resolve(opts.rootDir);
    const relDir = relative(rootDir, dirname(filePath));
    const filename = baseName.replace(/\.ck$/, '');

    const typesOutput = opts.server.types.output;
    const routesOutput = opts.server.routes.output;
    const defaultTypesName = `${filename}.ts`;
    const defaultRoutesName = `${filename}.router.ts`;

    function resolveOne(output: string | undefined, defaultName: string): string {
        if (output && TEMPLATE_VAR_RE.test(output)) {
            const resolved = resolveTemplate(output, { filename, dir: relDir, ext: 'ck', ...meta });
            if (includesFilename(resolved)) return join(baseOutDir, resolved);
            return join(baseOutDir, resolved, defaultName);
        }
        if (output) {
            if (includesFilename(output)) return join(baseOutDir, output);
            return join(baseOutDir, output, relDir, defaultName);
        }
        return join(baseOutDir, relDir, defaultName);
    }

    return {
        typesOutPath: resolveOne(typesOutput, defaultTypesName),
        routesOutPath: resolveOne(routesOutput, defaultRoutesName),
    };
}

// ─── Prettier formatting ──────────────────────────────────────────────────

/**
 * Format generated files with the user's local prettier installation.
 * Mutates each entry's `content` in place. Silently skips if prettier is not
 * installed or if a file's content cannot be parsed by prettier.
 */
async function formatWithPrettier(results: { outPath: string; content: string }[]): Promise<void> {
    let prettier: typeof import('prettier');
    try {
        prettier = await import('prettier');
    } catch {
        console.warn('  ⚠  prettier not found — skipping format step');
        return;
    }
    for (const result of results) {
        try {
            const options = (await prettier.resolveConfig(result.outPath)) ?? {};
            result.content = await prettier.format(result.content, {
                ...options,
                filepath: result.outPath,
            });
        } catch {
            // Leave content unformatted if prettier fails (e.g. unsupported parser)
        }
    }
}

// ─── Content comparison ───────────────────────────────────────────────────

function isContentUnchanged(outPath: string, content: string): boolean {
    try {
        return existsSync(outPath) && readFileSync(outPath, 'utf-8') === content;
    } catch {
        return false;
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
    const cliArgs = parseArgs(process.argv);
    const { config: fileConfig, configDir } = loadConfig(cliArgs.config);
    const config = mergeConfig(fileConfig, cliArgs, configDir);
    const plugins = await loadPlugins(config.plugins, config.configDir);

    if (config.patterns.length === 0) {
        console.error('Usage: contractkit [--config <path>] [--watch] [--force]');
        console.error('');
        console.error('Options:');
        console.error('  -c, --config <path>  Path to config file (default: searches for contractkit.config.json)');
        console.error('  -w, --watch          Watch for changes and recompile');
        console.error('      --force          Skip cache and recompile all files');
        console.error('');
        console.error('Configure patterns, output dirs, and other options in contractkit.config.json.');
        process.exit(1);
    }

    const run = async () => {
        // Compute per-section base dirs: rootDir + baseDir
        const serverBase = resolve(config.rootDir, config.server.baseDir);
        const sdkBase = config.sdk?.baseDir ? resolve(config.rootDir, config.sdk.baseDir) : config.rootDir;

        // Resolve files per-section using section-specific base dirs
        const serverFiles = await resolveFiles([...(config.server.types.include ?? []), ...(config.server.routes.include ?? [])], serverBase);
        const sdkFiles = config.sdk
            ? await resolveFiles([...(config.sdk.types?.include ?? []), ...(config.sdk.clients?.include ?? [])], sdkBase)
            : [];
        const files = [...new Set([...serverFiles, ...sdkFiles])];

        if (files.length === 0) {
            console.warn(`No matching files found for patterns:`, config.patterns.join(', '));
            return;
        }

        const diag = new DiagnosticCollector();
        const resolvedBase = resolve(config.rootDir);
        const commonRoot = commonDir(files, config.rootDir);
        const cacheEnabled = config.cache.enabled && !config.force;
        const cache: FileHashMap = cacheEnabled ? loadCache(resolvedBase, config.cache.filename) : {};
        const newCache: FileHashMap = {};

        // ── Pass 1: Parse all .ck files ────────────────────────────────
        // allDtoInfo/allOpInfo track every file (even unchanged) for cross-file import resolution and SDK generation
        const allDtoInfo: { ast: ContractRootNode; filePath: string; outPath: string }[] = [];
        const allOpInfo: { ast: OpRootNode; filePath: string; outPath: string }[] = [];
        const contractRoots: { ast: ContractRootNode; filePath: string; outPath: string }[] = [];
        const opRoots: { ast: OpRootNode; filePath: string; outPath: string }[] = [];

        for (const filePath of files) {
            if (!filePath.endsWith('.ck')) {
                diag.warn(filePath, 0, `Skipping unknown file extension (expected .ck)`);
                continue;
            }

            const source = readFileSync(filePath, 'utf-8');
            const hash = computeHash(source);
            newCache[filePath] = hash;

            const serverOpts: OutPathOptions = { rootDir: serverBase, server: config.server };
            let ckAst = parseCk(source, filePath, diag);

            // Plugin: validate + transform hooks (run before decompose and cross-file validation)
            for (const { plugin, entry } of plugins) {
                const ctx = makePluginContext(entry, config);
                if (plugin.validate) {
                    try { await plugin.validate(ckAst, ctx); }
                    catch (err) { diag.error(filePath, 0, `[plugin:${plugin.name}] ${(err as Error).message}`); }
                }
                if (plugin.transform) {
                    try { ckAst = await plugin.transform(ckAst, ctx); }
                    catch (err) { diag.error(filePath, 0, `[plugin:${plugin.name}] ${(err as Error).message}`); }
                }
            }

            const { dto, op } = decomposeCk(ckAst);
            const paths = computeCkOutPaths(filePath, serverOpts, commonRoot, ckAst.meta);
            const { typesOutPath, routesOutPath } = paths;

            // Register models as DTO info
            if (dto.models.length > 0) {
                allDtoInfo.push({ ast: dto, filePath, outPath: typesOutPath });
                if (!config.force && !isFileChanged(filePath, source, typesOutPath, cache)) {
                    console.log(`  -  ${typesOutPath} (unchanged)`);
                } else {
                    contractRoots.push({ ast: dto, filePath, outPath: typesOutPath });
                }
            }

            // Register routes as OP info
            if (op.routes.length > 0) {
                allOpInfo.push({ ast: op, filePath, outPath: routesOutPath });
                if (!config.force && !isFileChanged(filePath, source, routesOutPath, cache)) {
                    console.log(`  -  ${routesOutPath} (unchanged)`);
                } else {
                    opRoots.push({ ast: op, filePath, outPath: routesOutPath });
                }
            }
        }

        // Build model → outPath map from ALL dto files for cross-file import resolution
        const modelOutPaths = new Map<string, string>();
        const modelsWithInput = new Set<string>();

        // Pass 1: register all model paths and direct-visibility Input variants
        const modelFieldRefs = new Map<string, { refs: Set<string>; outPath: string }>();
        for (const { ast, outPath } of allDtoInfo) {
            for (const model of ast.models) {
                modelOutPaths.set(model.name, outPath);
                if (model.fields.some(f => f.visibility !== 'normal')) {
                    modelsWithInput.add(model.name);
                    modelOutPaths.set(`${model.name}Input`, outPath);
                }
                // Collect type refs for transitive closure (fields + base + type alias)
                const refs = new Set<string>();
                for (const field of model.fields) {
                    collectTypeRefs(field.type, refs);
                }
                if (model.base) refs.add(model.base);
                if (model.type) collectTypeRefs(model.type, refs);
                modelFieldRefs.set(model.name, { refs, outPath });
            }
        }

        // Pass 2: transitive closure — add models that reference models with Input variants
        let changed = true;
        while (changed) {
            changed = false;
            for (const [modelName, { refs, outPath }] of modelFieldRefs) {
                if (modelsWithInput.has(modelName)) continue;
                for (const ref of refs) {
                    if (modelsWithInput.has(ref)) {
                        modelsWithInput.add(modelName);
                        modelOutPaths.set(`${modelName}Input`, outPath);
                        changed = true;
                        break;
                    }
                }
            }
        }

        // ── Dependency fingerprint ──────────────────────────────────
        // Cross-file state (model names, output paths, input variants) flows into
        // every generated file. If this state changes, all outputs must regenerate.
        const depsFingerprint = computeHash(
            [...modelOutPaths.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([k, v]) => `${k}:${v}`)
                .join('\n') +
                '\n' +
                [...modelsWithInput].sort().join(','),
        );
        const depsChanged = cacheEnabled && cache['__deps__'] !== depsFingerprint;
        newCache['__deps__'] = depsFingerprint;

        if (depsChanged) {
            // Cross-file dependencies changed — regenerate all outputs
            for (const info of allDtoInfo) {
                if (!contractRoots.includes(info)) contractRoots.push(info);
            }
            for (const info of allOpInfo) {
                if (!opRoots.includes(info)) opRoots.push(info);
            }
        }

        if (diag.hasErrors()) {
            diag.report();
            console.error('\nCompilation failed.');
            process.exitCode = 1;
            return;
        }

        // ── Pass 1.5: Cross-file validation ─────────────────────────
        validateRefs(
            contractRoots.map(r => r.ast),
            opRoots.map(r => r.ast),
            diag,
            allDtoInfo.map(r => r.ast),
        );

        // ── Pass 2: Generate code ───────────────────────────────────
        const results: { outPath: string; content: string }[] = [];

        for (const { ast, outPath } of contractRoots) {
            const content = generateContract(ast, { modelOutPaths, currentOutPath: outPath, modelsWithInput });
            results.push({ outPath, content });
        }

        for (const { ast } of opRoots) {
            validateOp(ast, diag);
        }

        const allPlugins = [...plugins];

        for (const { plugin, entry } of allPlugins) {
            if (!plugin.generateTargets) continue;

            // Incorporate entry.options into the cache key so changing plugin options
            // invalidates the cache (relevant for user-configured plugins).
            const optionsSuffix = entry.options && Object.keys(entry.options).length > 0
                ? `:${JSON.stringify(entry.options)}`
                : '';
            const cacheKey = plugin.cacheKey ? `${plugin.cacheKey}${optionsSuffix}` : undefined;
            if (cacheKey && !config.force && cacheEnabled) {
                const fingerprint = computePluginFingerprint(newCache, cacheKey);
                if (cache[`__plugin_${cacheKey}__`] === fingerprint && pluginOutputsExist(cache, cacheKey)) {
                    console.log(`  -  [plugin:${plugin.name}] (unchanged)`);
                    newCache[`__plugin_${cacheKey}__`] = fingerprint;
                    newCache[`__plugin_${cacheKey}__files__`] = cache[`__plugin_${cacheKey}__files__`] ?? '';
                    continue;
                }
            }

            const pluginEmitted: { outPath: string; content: string }[] = [];
            const ctx = makePluginContext(entry, config, (outPath, content) => {
                pluginEmitted.push({ outPath, content });
            });

            try {
                await plugin.generateTargets(
                    {
                        contractRoots: allDtoInfo.map(d => d.ast),
                        opRoots: allOpInfo.map(o => o.ast),
                        modelOutPaths,
                        modelsWithInput,
                    },
                    ctx,
                );
            } catch (err) {
                diag.error('', 0, `[plugin:${plugin.name}] generateTargets failed: ${(err as Error).message}`);
                continue;
            }

            results.push(...pluginEmitted);

            if (cacheKey) {
                newCache[`__plugin_${cacheKey}__`] = computePluginFingerprint(newCache, cacheKey);
                newCache[`__plugin_${cacheKey}__files__`] = pluginEmitted.map(f => f.outPath).join('|');
            }
        }

        diag.report();

        if (diag.hasErrors()) {
            console.error('\nCompilation failed.');
            process.exitCode = 1;
            return;
        }

        // ── Generate barrel index files for DTO directories ─────────
        const barrelFiles = generateBarrelFiles(allDtoInfo.map(d => d.outPath));

        // ── Format with prettier (opt-in) ────────────────────────────
        // Format before writing so barrel unchanged-check uses formatted content.
        if (config.prettier) {
            const toFormat = [...results, ...barrelFiles];
            if (toFormat.length > 0) {
                await formatWithPrettier(toFormat);
            }
        }

        // ── Write output files ──────────────────────────────────────
        mkdirSync(resolvedBase, { recursive: true });

        for (const { outPath, content } of results) {
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, content, 'utf-8');
            console.log(`  ✓  ${outPath}`);
        }

        for (const { outPath, content } of barrelFiles) {
            if (!config.force && isContentUnchanged(outPath, content)) {
                console.log(`  -  ${outPath} (unchanged)`);
                continue;
            }
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, content, 'utf-8');
            console.log(`  ✓  ${outPath}`);
        }

        // Save cache — always save when cache is configured, even after --force,
        // so subsequent non-force runs have accurate hashes.
        if (config.cache.enabled) {
            saveCache(resolvedBase, newCache, config.cache.filename);
        }

        console.log(`\nCompiled ${results.length} file(s).`);
    };

    await run();

    if (config.watch) {
        const { watch } = await import('node:fs');
        const serverBase = resolve(config.rootDir, config.server.baseDir);
        const sdkBase = config.sdk?.baseDir ? resolve(config.rootDir, config.sdk.baseDir) : config.rootDir;
        const watchServerFiles = await resolveFiles([...(config.server.types.include ?? []), ...(config.server.routes.include ?? [])], serverBase);
        const watchSdkFiles = config.sdk
            ? await resolveFiles([...(config.sdk.types?.include ?? []), ...(config.sdk.clients?.include ?? [])], sdkBase)
            : [];
        const allDirs = new Set([...watchServerFiles, ...watchSdkFiles].map(f => dirname(f)));
        console.log('\nWatching for changes...');
        for (const dir of allDirs) {
            watch(dir, { recursive: false }, async (event, filename) => {
                if (!filename) return;
                const full = join(dir, filename);
                if (!full.endsWith('.ck')) return;
                console.log(`\nChange detected: ${filename}`);
                await run();
            });
        }
    }
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
