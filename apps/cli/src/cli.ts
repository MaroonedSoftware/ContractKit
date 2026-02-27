#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { glob } from 'glob';
import { DiagnosticCollector } from './diagnostics.js';
import { parseDto } from './parser-dto.js';
import { parseOp } from './parser-op.js';
import { generateDto } from './codegen-dto.js';
import type { DtoCodegenContext } from './codegen-dto.js';
import { generateOp } from './codegen-op.js';
import { validateOp } from './validate-op.js';
import { validateRefs } from './validate-refs.js';
import { loadConfig, mergeConfig } from './config.js';
import { loadCache, saveCache, computeHash, isFileChanged } from './cache.js';
import type { ResolvedConfig } from './config.js';
import type { DtoRootNode, OpRootNode } from './ast.js';
import type { FileHashMap } from './cache.js';

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

async function resolveFiles(patterns: string[], baseDir: string): Promise<string[]> {
    console.log(resolve(baseDir));
    const files: string[] = [];
    for (const pattern of patterns) {
        const matches = await glob(pattern, { absolute: true, cwd: resolve(baseDir) });
        files.push(...matches);
    }
    return [...new Set(files)];
}

// ─── Output path computation ──────────────────────────────────────────────

interface OutPathOptions {
    baseDir: string;
    dto: { output?: string };
    routes: { output?: string };
}

const TEMPLATE_VAR_RE = /\{\w+\}/;

function resolveTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/** Check whether a path's last segment contains a file extension. */
function includesFilename(p: string): boolean {
    const last = p.split('/').pop() ?? '';
    return last.includes('.');
}

function computeOutPath(filePath: string, opts: OutPathOptions, rootDir: string, meta: Record<string, string> = {}): string | null {
    const ext = filePath.endsWith('.dto') ? 'dto' : filePath.endsWith('.op') ? 'op' : null;
    if (!ext) return null;

    const baseName = filePath.split('/').pop()!;
    const defaultOutName = ext === 'dto' ? baseName.replace(/\.dto$/, '.ts') : baseName.replace(/\.op$/, '.router.ts');

    const baseOutDir = resolve(opts.baseDir);
    const output = ext === 'dto' ? opts.dto.output : opts.routes.output;
    const relDir = relative(rootDir, dirname(filePath));
    const filename = baseName.replace(/\.\w+$/, '');

    if (output && TEMPLATE_VAR_RE.test(output)) {
        const resolved = resolveTemplate(output, {
            filename,
            dir: relDir,
            ext,
            ...meta,
        });
        if (includesFilename(resolved)) {
            return join(baseOutDir, resolved);
        }
        return join(baseOutDir, resolved, defaultOutName);
    }

    if (output) {
        if (includesFilename(output)) {
            return join(baseOutDir, output);
        }
        return join(baseOutDir, output, relDir, defaultOutName);
    }

    return join(baseOutDir, relDir, defaultOutName);
}

/** Find the longest common directory prefix of a list of absolute paths. */
function commonDir(files: string[], baseDir: string): string {
    if (files.length === 0) return resolve(baseDir);
    const parts = files.map(f => dirname(f).split('/'));
    const first = parts[0]!;
    let depth = first.length;
    for (const p of parts) {
        for (let i = 0; i < depth; i++) {
            if (p[i] !== first[i]) {
                depth = i;
                break;
            }
        }
    }
    return first.slice(0, depth).join('/') || '/';
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
    const cliArgs = parseArgs(process.argv);
    const fileConfig = loadConfig(cliArgs.config);
    const config = mergeConfig(fileConfig, cliArgs);

    if (config.patterns.length === 0) {
        console.error('Usage: dsl-compile [--config <path>] [--watch] [--force]');
        console.error('');
        console.error('Options:');
        console.error('  -c, --config <path>  Path to config file (default: searches for contract-dsl.config.json)');
        console.error('  -w, --watch          Watch for changes and recompile');
        console.error('      --force          Skip cache and recompile all files');
        console.error('');
        console.error('Configure patterns, output dirs, and other options in contract-dsl.config.json.');
        process.exit(1);
    }

    const run = async () => {
        const files = await resolveFiles(config.patterns, config.baseDir);

        if (files.length === 0) {
            console.warn(`No matching files found for patterns: ${config.baseDir}:`, config.patterns.join(', '));
            return;
        }

        const diag = new DiagnosticCollector();
        const resolvedBase = resolve(config.baseDir);
        const rootDir = commonDir(files, config.baseDir);
        const cacheEnabled = config.cache.enabled && !config.force;
        const cache: FileHashMap = cacheEnabled ? loadCache(resolvedBase, config.cache.filename) : {};
        const newCache: FileHashMap = {};

        // ── Pass 1: Parse all files ─────────────────────────────────
        // allDtoInfo tracks every DTO file (even unchanged) for cross-file import resolution
        const allDtoInfo: { ast: DtoRootNode; filePath: string; outPath: string }[] = [];
        const dtoRoots: { ast: DtoRootNode; filePath: string; outPath: string }[] = [];
        const opRoots: { ast: OpRootNode; filePath: string; outPath: string }[] = [];

        for (const filePath of files) {
            const ext = filePath.endsWith('.dto') ? 'dto' : filePath.endsWith('.op') ? 'op' : null;
            if (!ext) {
                diag.warn(filePath, 0, `Skipping unknown file extension`);
                continue;
            }

            const source = readFileSync(filePath, 'utf-8');
            const hash = computeHash(source);
            newCache[filePath] = hash;

            // Parse first so meta directives are available for output path resolution
            if (ext === 'dto') {
                const ast = parseDto(source, filePath, diag);
                const outPath = computeOutPath(filePath, config, rootDir, ast.meta);
                if (!outPath) continue;
                allDtoInfo.push({ ast, filePath, outPath });
                if (!config.force && !isFileChanged(filePath, source, outPath, cache)) {
                    console.log(`  -  ${relative(resolvedBase, outPath)} (unchanged)`);
                    continue;
                }
                dtoRoots.push({ ast, filePath, outPath });
            } else {
                const outPath = computeOutPath(filePath, config, rootDir);
                if (!outPath) continue;
                if (!config.force && !isFileChanged(filePath, source, outPath, cache)) {
                    console.log(`  -  ${relative(resolvedBase, outPath)} (unchanged)`);
                    continue;
                }
                const ast = parseOp(source, filePath, diag);
                opRoots.push({ ast, filePath, outPath });
            }
        }

        // Build model → outPath map from ALL dto files for cross-file import resolution
        const modelOutPaths = new Map<string, string>();
        for (const { ast, outPath } of allDtoInfo) {
            for (const model of ast.models) {
                modelOutPaths.set(model.name, outPath);
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
            dtoRoots.map(r => r.ast),
            opRoots.map(r => r.ast),
            diag,
        );

        // ── Pass 2: Generate code ───────────────────────────────────
        const results: { outPath: string; content: string }[] = [];

        for (const { ast, outPath } of dtoRoots) {
            const content = generateDto(ast, { modelOutPaths, currentOutPath: outPath });
            results.push({ outPath, content });
        }

        for (const { ast, outPath } of opRoots) {
            validateOp(ast, diag);
            const content = generateOp(ast, {
                servicePathTemplate: config.routes.servicePathTemplate,
                typeImportPathTemplate: config.routes.typeImportPathTemplate,
            });
            results.push({ outPath, content });
        }

        diag.report();

        if (diag.hasErrors()) {
            console.error('\nCompilation failed.');
            process.exitCode = 1;
            return;
        }

        // ── Write output files ──────────────────────────────────────
        mkdirSync(resolvedBase, { recursive: true });

        for (const { outPath, content } of results) {
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, content, 'utf-8');
            console.log(`  ✓  ${relative(resolvedBase, outPath)}`);
        }

        // Save cache
        if (cacheEnabled) {
            saveCache(resolvedBase, newCache, config.cache.filename);
        }

        console.log(`\nCompiled ${results.length} file(s).`);
    };

    await run();

    if (config.watch) {
        const { watch } = await import('node:fs');
        const allDirs = new Set((await resolveFiles(config.patterns, config.baseDir)).map(f => dirname(f)));
        console.log('\nWatching for changes...');
        for (const dir of allDirs) {
            watch(dir, { recursive: false }, async (event, filename) => {
                if (!filename) return;
                const full = join(dir, filename);
                if (!full.endsWith('.dto') && !full.endsWith('.op')) return;
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
