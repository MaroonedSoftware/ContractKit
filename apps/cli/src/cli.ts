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
import { generateSdk, generateSdkOptions, generateSdkAggregator, deriveClientClassName, deriveClientPropertyName } from './codegen-sdk.js';
import { generatePlainTypes } from './codegen-plain-types.js';
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

    const baseOutDir = resolve(opts.rootDir);
    const output = ext === 'dto' ? opts.server.types.output : opts.server.routes.output;
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

function computeSdkOutPath(filePath: string, rootDir: string, clientOutput: string | undefined, commonRoot: string, meta: Record<string, string> = {}): string | null {
    if (!filePath.endsWith('.op')) return null;

    const baseName = filePath.split('/').pop()!;
    const defaultOutName = baseName.replace(/\.op$/, '.client.ts');
    const baseOutDir = resolve(rootDir);
    const relDir = relative(commonRoot, dirname(filePath));
    const filename = baseName.replace(/\.\w+$/, '');

    if (clientOutput && TEMPLATE_VAR_RE.test(clientOutput)) {
        const resolved = resolveTemplate(clientOutput, {
            filename,
            dir: relDir,
            ext: 'op',
            ...meta,
        });
        if (includesFilename(resolved)) {
            return join(baseOutDir, resolved);
        }
        return join(baseOutDir, resolved, defaultOutName);
    }

    if (clientOutput) {
        if (includesFilename(clientOutput)) {
            return join(baseOutDir, clientOutput);
        }
        return join(baseOutDir, clientOutput, relDir, defaultOutName);
    }

    return join(baseOutDir, relDir, defaultOutName);
}

function computeSdkTypeOutPath(filePath: string, rootDir: string, typeOutput: string, commonRoot: string, meta: Record<string, string> = {}): string | null {
    if (!filePath.endsWith('.dto')) return null;

    const baseName = filePath.split('/').pop()!;
    const defaultOutName = baseName.replace(/\.dto$/, '.ts');
    const baseOutDir = resolve(rootDir);
    const relDir = relative(commonRoot, dirname(filePath));
    const filename = baseName.replace(/\.\w+$/, '');

    if (TEMPLATE_VAR_RE.test(typeOutput)) {
        const resolved = resolveTemplate(typeOutput, {
            filename,
            dir: relDir,
            ext: 'dto',
            ...meta,
        });
        if (includesFilename(resolved)) {
            return join(baseOutDir, resolved);
        }
        return join(baseOutDir, resolved, defaultOutName);
    }

    if (includesFilename(typeOutput)) {
        return join(baseOutDir, typeOutput);
    }
    return join(baseOutDir, typeOutput, relDir, defaultOutName);
}

/** Find the longest common directory prefix of a list of absolute paths. */
function commonDir(files: string[], rootDir: string): string {
    if (files.length === 0) return resolve(rootDir);
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

// ─── Barrel file generation ───────────────────────────────────────────────

function generateBarrelFiles(dtoPaths: string[]): { outPath: string; content: string }[] {
    // Group DTO output files by directory
    const byDir = new Map<string, string[]>();
    for (const outPath of dtoPaths) {
        const dir = dirname(outPath);
        const group = byDir.get(dir) ?? [];
        group.push(outPath);
        byDir.set(dir, group);
    }

    const results: { outPath: string; content: string }[] = [];
    for (const [dir, files] of byDir) {
        const exports = files
            .map(f => {
                const base = f.split('/').pop()!.replace(/\.ts$/, '.js');
                return `export * from './${base}';`;
            })
            .sort()
            .join('\n');

        const content = `// Auto-generated barrel file\n${exports}\n`;
        results.push({ outPath: join(dir, 'index.ts'), content });
    }

    return results;
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
        // Compute per-section base dirs: rootDir + baseDir
        const serverBase = resolve(config.rootDir, config.server.baseDir);
        const sdkBase = config.sdk?.baseDir
            ? resolve(config.rootDir, config.sdk.baseDir)
            : config.rootDir;

        // Resolve files per-section using section-specific base dirs
        const serverFiles = await resolveFiles(
            [...(config.server.types.include ?? []), ...(config.server.routes.include ?? [])],
            serverBase,
        );
        const sdkFiles = config.sdk
            ? await resolveFiles(
                  [...(config.sdk.types?.include ?? []), ...(config.sdk.clients?.include ?? [])],
                  sdkBase,
              )
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
            const serverOpts: OutPathOptions = { rootDir: serverBase, server: config.server };
            if (ext === 'dto') {
                const ast = parseDto(source, filePath, diag);
                const outPath = computeOutPath(filePath, serverOpts, commonRoot, ast.meta);
                if (!outPath) continue;
                allDtoInfo.push({ ast, filePath, outPath });
                if (!config.force && !isFileChanged(filePath, source, outPath, cache)) {
                    console.log(`  -  ${relative(resolvedBase, outPath)} (unchanged)`);
                    continue;
                }
                dtoRoots.push({ ast, filePath, outPath });
            } else {
                const ast = parseOp(source, filePath, diag);
                const outPath = computeOutPath(filePath, serverOpts, commonRoot, ast.meta);
                if (!outPath) continue;
                if (!config.force && !isFileChanged(filePath, source, outPath, cache)) {
                    console.log(`  -  ${relative(resolvedBase, outPath)} (unchanged)`);
                    continue;
                }
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
                servicePathTemplate: config.server.routes.servicePathTemplate,
                typeImportPathTemplate: config.server.routes.typeImportPathTemplate,
                outPath,
                modelOutPaths,
            });
            results.push({ outPath, content });
        }

        // ── SDK generation (opt-in via config.sdk) ──────────────
        const sdkClientInfos: { outPath: string; className: string; propertyName: string }[] = [];
        const sdkEntryPath = config.sdk?.output
            ? join(sdkBase, config.sdk.output)
            : join(sdkBase, 'sdk.ts');
        const sdkOptionsPath = join(dirname(sdkEntryPath), 'sdk-options.ts');

        if (config.sdk) {
            // If sdk.types is configured, generate DTO files into the SDK package
            // and build a separate model→path map for SDK import resolution
            let sdkModelOutPaths = modelOutPaths;
            if (config.sdk.types?.output) {
                sdkModelOutPaths = new Map<string, string>();
                for (const { ast, filePath, outPath: dtoOutPath } of allDtoInfo) {
                    const typeOutPath = computeSdkTypeOutPath(
                        filePath,
                        sdkBase,
                        config.sdk.types.output,
                        commonRoot,
                        ast.meta,
                    );
                    if (!typeOutPath) continue;
                    // Generate plain TypeScript types (not Zod schemas) for the SDK package
                    const content = generatePlainTypes(ast, { modelOutPaths: sdkModelOutPaths, currentOutPath: typeOutPath });
                    results.push({ outPath: typeOutPath, content });
                    for (const model of ast.models) {
                        sdkModelOutPaths.set(model.name, typeOutPath);
                    }
                }
            }

            if (config.sdk.clients) {
                for (const { ast, filePath } of opRoots) {
                    const sdkOutPath = computeSdkOutPath(
                        filePath,
                        sdkBase,
                        config.sdk.clients.output,
                        commonRoot,
                        ast.meta,
                    );
                    if (!sdkOutPath) continue;
                    const content = generateSdk(ast, {
                        typeImportPathTemplate: config.sdk.clients.typeImportPathTemplate ?? config.server.routes.typeImportPathTemplate,
                        outPath: sdkOutPath,
                        modelOutPaths: sdkModelOutPaths,
                        sdkOptionsPath,
                    });
                    results.push({ outPath: sdkOutPath, content });
                    sdkClientInfos.push({
                        outPath: sdkOutPath,
                        className: deriveClientClassName(ast.file),
                        propertyName: deriveClientPropertyName(ast.file),
                    });
                }
            }

            // Generate shared sdk-options.ts
            results.push({ outPath: sdkOptionsPath, content: generateSdkOptions() });

            // Generate sdk.ts aggregator
            if (sdkClientInfos.length > 0) {
                const sdkEntryDir = dirname(sdkEntryPath);
                const clients = sdkClientInfos.map(c => {
                    let rel = relative(sdkEntryDir, c.outPath).replace(/\.ts$/, '.js');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    return { className: c.className, propertyName: c.propertyName, importPath: rel };
                });
                const sdkOptionsRel = relative(sdkEntryDir, sdkOptionsPath).replace(/\.ts$/, '.js');
                results.push({
                    outPath: sdkEntryPath,
                    content: generateSdkAggregator(clients, sdkOptionsRel.startsWith('.') ? sdkOptionsRel : './' + sdkOptionsRel),
                });
            }
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
            console.log(`  ✓  ${outPath}`);
        }

        // ── Generate barrel index files for DTO directories ─────────
        const barrelFiles = generateBarrelFiles(allDtoInfo.map(d => d.outPath));
        for (const { outPath, content } of barrelFiles) {
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, content, 'utf-8');
            console.log(`  ✓  ${relative(resolvedBase, outPath)} (barrel)`);
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
        const serverBase = resolve(config.rootDir, config.server.baseDir);
        const sdkBase = config.sdk?.baseDir
            ? resolve(config.rootDir, config.sdk.baseDir)
            : config.rootDir;
        const watchServerFiles = await resolveFiles(
            [...(config.server.types.include ?? []), ...(config.server.routes.include ?? [])],
            serverBase,
        );
        const watchSdkFiles = config.sdk
            ? await resolveFiles(
                  [...(config.sdk.types?.include ?? []), ...(config.sdk.clients?.include ?? [])],
                  sdkBase,
              )
            : [];
        const allDirs = new Set([...watchServerFiles, ...watchSdkFiles].map(f => dirname(f)));
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
