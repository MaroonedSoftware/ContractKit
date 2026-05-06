#!/usr/bin/env node

// ─── Built-in command plugins ─────────────────────────────────────────────
// Each plugin may expose a `command` hook — the CLI dispatches subcommands
// to the first plugin whose command.name matches argv[2].
import { default as importOpenApiPlugin } from '@contractkit/openapi-to-ck/plugin';

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { glob } from 'glob';
import {
    DiagnosticCollector,
    parseCk,
    decomposeCk,
    validateOp,
    validateRefs,
    validateInheritance,
    applyOptionsDefaults,
    applyVariableSubstitution,
    computeModelsWithInput,
    computeModelsWithOutput,
} from '@contractkit/core';
import type { ContractRootNode, OpRootNode, ContractKitPlugin } from '@contractkit/core';
import { loadConfig, mergeConfig, type PluginEntry } from './config.js';
import { CacheService, computeHash } from './cache.js';
import { loadPlugins, makePluginContext, computePluginFingerprint, pluginOutputsExist } from './plugin.js';
import { resolvePluginExtensions } from './resolve-plugin-extensions.js';
import type { FileHashMap } from './cache.js';

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

// ─── Fallback keys for {{var}} substitution ────────────────────────────────

/**
 * Built-in variables available inside plugin-config `keys` values. These let a
 * user write `"{{rootDir}}/path"` in `contractkit.config.json` and have the
 * absolute resolved root substituted in at load time.
 */
const FALLBACK_BUILTINS_RE = /\\\{\{(\w+)\}\}|\{\{(\w+)\}\}/g;

function substituteBuiltins(input: string, builtins: Record<string, string>, onMissing: (name: string) => void): string {
    if (!input.includes('{{')) return input;
    return input.replace(FALLBACK_BUILTINS_RE, (_match, escapedName: string | undefined, varName: string | undefined) => {
        if (escapedName !== undefined) return `{{${escapedName}}}`;
        const value = builtins[varName!];
        if (value === undefined) {
            onMissing(varName!);
            return 'undefined';
        }
        return value;
    });
}

function collectFallbackKeys(entries: PluginEntry[], builtins: Record<string, string>): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const entry of entries) {
        const keys = entry.options?.['keys'];
        if (keys === undefined) continue;
        if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
            console.warn(`  ⚠  [plugin:${entry.plugin}] 'keys' must be an object of string→string; ignoring.`);
            continue;
        }
        for (const [name, value] of Object.entries(keys)) {
            if (typeof value !== 'string') {
                console.warn(`  ⚠  [plugin:${entry.plugin}] 'keys.${name}' must be a string; ignoring.`);
                continue;
            }
            merged[name] = substituteBuiltins(value, builtins, missing => {
                console.warn(`  ⚠  [plugin:${entry.plugin}] 'keys.${name}' references unknown built-in '{{${missing}}}'.`);
            });
        }
    }
    return merged;
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

    // Merge `keys` from each plugin entry's options into a single workspace-wide fallback
    // map for `{{var}}` substitution. File-local `options { keys }` always wins; this map
    // catches anything that isn't defined per-file. Built-in variables (`rootDir`,
    // `configDir`) can be referenced inside the values themselves.
    const fallbackKeys = collectFallbackKeys(config.plugins, {
        rootDir: config.rootDir,
        configDir: config.configDir,
    });

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
        const cacheService = new CacheService(resolvedBase, { enabled: cacheEnabled, dir: config.cache.dir });
        const cache: FileHashMap = cacheService.loadBuildCache();
        const newCache: FileHashMap = {};

        // ── Parse all .ck files ────────────────────────────────────────
        const allContracts: ContractRootNode[] = [];
        const allOps: OpRootNode[] = [];

        for (const filePath of files) {
            if (!filePath.endsWith('.ck')) {
                diag.warn(filePath, 0, `Skipping unknown file extension (expected .ck)`);
                continue;
            }

            const source = readFileSync(filePath, 'utf-8');
            newCache[filePath] = computeHash(source);

            let ckAst = parseCk(source, filePath, diag);
            // Merge options-level header globals into each operation before plugins run,
            // so transform/validate hooks see the fully-resolved AST.
            applyOptionsDefaults(ckAst, diag);
            applyVariableSubstitution(ckAst, diag, fallbackKeys);

            // Plugin: validate + transform hooks (run before decompose and cross-file validation)
            for (const { plugin, entry } of plugins) {
                const ctx = makePluginContext(entry, config);
                if (plugin.validate) {
                    try {
                        await plugin.validate(ckAst, ctx);
                    } catch (err) {
                        diag.error(filePath, 0, `[plugin:${plugin.name}] ${(err as Error).message}`);
                    }
                }
                if (plugin.transform) {
                    try {
                        ckAst = await plugin.transform(ckAst, ctx);
                    } catch (err) {
                        diag.error(filePath, 0, `[plugin:${plugin.name}] ${(err as Error).message}`);
                    }
                }
            }

            const { contract, op } = decomposeCk(ckAst);
            if (contract.models.length > 0) allContracts.push(contract);
            if (op.routes.length > 0) allOps.push(op);
        }

        // ── Resolve plugin extension URL references (file:// and http(s)://) ──
        await resolvePluginExtensions(allOps, resolvedBase, diag, { httpCache: cacheService.httpCache() });

        // ── Per-plugin extension validation ───────────────────────────
        const validatorsByName = new Map<string, NonNullable<ContractKitPlugin['validateExtension']>>();
        for (const { plugin } of plugins) {
            if (plugin.validateExtension) validatorsByName.set(plugin.name, plugin.validateExtension);
        }
        for (const root of allOps) {
            for (const route of root.routes) {
                for (const op of route.operations) {
                    if (!op.pluginExtensions) continue;
                    for (const [name, value] of Object.entries(op.pluginExtensions)) {
                        const validator = validatorsByName.get(name);
                        if (!validator) continue;
                        const result = validator(value);
                        if (!result) continue;
                        if (result.errors) {
                            for (const msg of result.errors) {
                                diag.error(root.file, op.loc.line, `plugins.${name}: ${msg}`);
                            }
                        }
                        if (result.warnings) {
                            for (const msg of result.warnings) {
                                diag.warn(root.file, op.loc.line, `plugins.${name}: ${msg}`);
                            }
                        }
                    }
                }
            }
        }

        // ── Compute cross-file semantics ───────────────────────────────
        // modelsWithInput: which model names need an Input variant (have readonly/writeonly
        // fields, or transitively reference models that do). Used by all code generators.
        const modelsWithInput = computeModelsWithInput(allContracts.flatMap(r => r.models));
        // modelsWithOutput: which model names need an Output variant (have format(output=...),
        // or transitively reference models that do). Used by codegen for the post-transform
        // wire shape on response bodies.
        const modelsWithOutput = computeModelsWithOutput(allContracts.flatMap(r => r.models));

        // ── Dependency fingerprint ─────────────────────────────────────
        const depsFingerprint = computeHash([...modelsWithInput].sort().join(',') + '|' + [...modelsWithOutput].sort().join(','));
        const depsChanged = cacheEnabled && cache['__deps__'] !== depsFingerprint;
        newCache['__deps__'] = depsFingerprint;

        if (diag.hasErrors()) {
            diag.report();
            console.error('\nCompilation failed.');
            process.exitCode = 1;
            return;
        }

        // ── Cross-file validation ──────────────────────────────────────
        validateRefs(allContracts, allOps, diag);
        validateInheritance(allContracts, diag);

        for (const op of allOps) {
            validateOp(op, diag);
        }

        // ── Generate via plugins ───────────────────────────────────────
        const results: { outPath: string; content: string }[] = [];

        for (const { plugin, entry } of plugins) {
            if (!plugin.generateTargets) continue;

            const optionsSuffix = entry.options && Object.keys(entry.options).length > 0 ? `:${JSON.stringify(entry.options)}` : '';
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
                        contractRoots: allContracts,
                        opRoots: allOps,
                        modelsWithInput,
                        modelsWithOutput,
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

        if (diag.hasErrors()) {
            diag.report();
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
            cacheService.saveBuildCache(newCache);
        }

        // Report all collected warnings/errors after file writes so they
        // appear at the bottom of the output and are easy to spot.
        diag.report();

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
