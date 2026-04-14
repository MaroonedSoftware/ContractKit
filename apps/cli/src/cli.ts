#!/usr/bin/env node

// ─── Built-in command plugins ─────────────────────────────────────────────
// Each plugin may expose a `command` hook — the CLI dispatches subcommands
// to the first plugin whose command.name matches argv[2].
import { default as importOpenApiPlugin } from '@maroonedsoftware/openapi-to-ck/plugin';

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { glob } from 'glob';
import {
    DiagnosticCollector,
    parseCk,
    decomposeCk,
    validateOp,
    validateRefs,
    computeModelsWithInput,
} from '@maroonedsoftware/contractkit';
import type { ContractRootNode, OpRootNode, CkRootNode } from '@maroonedsoftware/contractkit';
import { loadConfig, mergeConfig } from './config.js';
import { loadCache, saveCache, computeHash } from './cache.js';
import { loadPlugins, makePluginContext, computePluginFingerprint, pluginOutputsExist } from './plugin.js';
import type { ResolvedConfig } from './config.js';
import type { FileHashMap } from './cache.js';
import type { LoadedPlugin } from './plugin.js';

// ─── Arg parsing ───────────────────────────────────────────────────────────

interface CliArgs {
    config?: string;
    watch: boolean;
    force: boolean;
    help: boolean;
}

const BUILTIN_COMMAND_PLUGINS = [importOpenApiPlugin];

function printHelp(): void {
    console.log('Usage: contractkit [command] [options]');
    console.log('');
    console.log('Commands:');
    for (const plugin of BUILTIN_COMMAND_PLUGINS) {
        if (plugin.command) {
            console.log(`  ${plugin.command.name.padEnd(20)} ${plugin.command.description}`);
        }
    }
    console.log('');
    console.log('Options:');
    console.log('  -c, --config <path>  Path to config file (default: contractkit.config.json)');
    console.log('  -w, --watch          Watch for changes and recompile');
    console.log('      --force          Skip cache and recompile all files');
    console.log('  -h, --help           Show this help message');
    console.log('');
    console.log('Configure patterns, output dirs, and plugins in contractkit.config.json.');
}

function parseArgs(argv: string[]): CliArgs {
    const args = argv.slice(2);
    let config: string | undefined;
    let watch = false;
    let force = false;
    let help = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--config' || arg === '-c') {
            config = args[++i];
        } else if (arg === '--watch' || arg === '-w') {
            watch = true;
        } else if (arg === '--force') {
            force = true;
        } else if (arg === '--help' || arg === '-h') {
            help = true;
        }
    }

    return { config, watch, force, help };
}

// ─── File resolution ───────────────────────────────────────────────────────

async function resolveFiles(patterns: string[], rootDir: string): Promise<string[]> {
    const files: string[] = [];
    for (const pattern of patterns) {
        const matches = await glob(pattern, { absolute: true, cwd: resolve(rootDir) });
        files.push(...matches);
    }
    return [...new Set(files)];
}

// ─── Prettier formatting ──────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
    const cliArgs = parseArgs(process.argv);

    if (cliArgs.help) {
        printHelp();
        process.exit(0);
    }

    // ── Built-in subcommand dispatch ──────────────────────────────────────
    const subcommand = process.argv[2];
    if (subcommand && !subcommand.startsWith('-')) {
        const matched = BUILTIN_COMMAND_PLUGINS.find(p => p.command?.name === subcommand);
        if (matched?.command) {
            const subArgs = process.argv.slice(3);
            if (subArgs.includes('--help') || subArgs.includes('-h')) {
                console.log(matched.command.usage);
                process.exit(0);
            }
            const { config: fileConfig, configDir } = loadConfig(cliArgs.config);
            const resolved = mergeConfig(fileConfig, { watch: false, force: false }, configDir);
            await matched.command.run(subArgs, { rootDir: resolved.rootDir, configDir });
            process.exit(0);
        }
        console.error(`Unknown command: "${subcommand}". Run "contractkit --help" for usage.`);
        process.exit(1);
    }

    const { config: fileConfig, configDir } = loadConfig(cliArgs.config);
    const config = mergeConfig(fileConfig, cliArgs, configDir);
    const plugins = await loadPlugins(config.plugins, config.configDir);

    if (config.patterns.length === 0) {
        printHelp();
        process.exit(1);
    }

    const run = async () => {
        const files = await resolveFiles(config.patterns, config.rootDir);

        if (files.length === 0) {
            console.warn(`No matching files found for patterns:`, config.patterns.join(', '));
            return;
        }

        const diag = new DiagnosticCollector();
        const resolvedBase = resolve(config.rootDir);
        const cacheEnabled = config.cache.enabled && !config.force;
        const cache: FileHashMap = cacheEnabled ? loadCache(resolvedBase, config.cache.filename) : {};
        const newCache: FileHashMap = {};

        // ── Parse all .ck files ────────────────────────────────────────
        const allDtos: ContractRootNode[] = [];
        const allOps: OpRootNode[] = [];

        for (const filePath of files) {
            if (!filePath.endsWith('.ck')) {
                diag.warn(filePath, 0, `Skipping unknown file extension (expected .ck)`);
                continue;
            }

            const source = readFileSync(filePath, 'utf-8');
            newCache[filePath] = computeHash(source);

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
            if (dto.models.length > 0) allDtos.push(dto);
            if (op.routes.length > 0) allOps.push(op);
        }

        // ── Compute cross-file semantics ───────────────────────────────
        // modelsWithInput: which model names need an Input variant (have readonly/writeonly
        // fields, or transitively reference models that do). Used by all code generators.
        const modelsWithInput = computeModelsWithInput(allDtos.flatMap(r => r.models));

        // ── Dependency fingerprint ─────────────────────────────────────
        const depsFingerprint = computeHash([...modelsWithInput].sort().join(','));
        const depsChanged = cacheEnabled && cache['__deps__'] !== depsFingerprint;
        newCache['__deps__'] = depsFingerprint;

        if (diag.hasErrors()) {
            diag.report();
            console.error('\nCompilation failed.');
            process.exitCode = 1;
            return;
        }

        // ── Cross-file validation ──────────────────────────────────────
        validateRefs(allDtos, allOps, diag);

        for (const op of allOps) {
            validateOp(op, diag);
        }

        // ── Generate via plugins ───────────────────────────────────────
        const results: { outPath: string; content: string }[] = [];

        for (const { plugin, entry } of plugins) {
            if (!plugin.generateTargets) continue;

            const optionsSuffix = entry.options && Object.keys(entry.options).length > 0
                ? `:${JSON.stringify(entry.options)}`
                : '';
            const cacheKey = plugin.cacheKey ? `${plugin.cacheKey}${optionsSuffix}` : undefined;
            if (cacheKey && !config.force && cacheEnabled && !depsChanged) {
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
                        contractRoots: allDtos,
                        opRoots: allOps,
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

        // ── Format with prettier (opt-in) ────────────────────────────
        if (config.prettier && results.length > 0) {
            await formatWithPrettier(results);
        }

        // ── Write output files ──────────────────────────────────────
        mkdirSync(resolvedBase, { recursive: true });

        for (const { outPath, content } of results) {
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, content, 'utf-8');
            console.log(`  ✓  ${outPath}`);
        }

        // Save cache
        if (config.cache.enabled) {
            saveCache(resolvedBase, newCache, config.cache.filename);
        }

        console.log(`\nCompiled ${results.length} file(s).`);
    };

    await run();

    if (config.watch) {
        const { watch } = await import('node:fs');
        const watchFiles = await resolveFiles(config.patterns, config.rootDir);
        const allDirs = new Set(watchFiles.map(f => dirname(f)));
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
