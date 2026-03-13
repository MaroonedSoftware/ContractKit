#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative, basename } from 'node:path';
import { glob } from 'glob';
import { DiagnosticCollector } from './diagnostics.js';
import { parseDto } from './parser-dto.js';
import { parseOp } from './parser-op.js';
import { generateDto, collectTypeRefs } from './codegen-dto.js';
import type { DtoCodegenContext } from './codegen-dto.js';
import { generateOp } from './codegen-op.js';
import { generateSdk, generateSdkOptions, generateSdkAggregator, deriveClientClassName, deriveClientPropertyName, hasPublicOperations, collectPublicTypeNames } from './codegen-sdk.js';
import { generatePlainTypes } from './codegen-plain-types.js';
import { generateOpenApi } from './codegen-openapi.js';
import { generateMarkdown } from './codegen-markdown.js';
import { validateOp, validateSecurity } from './validate-op.js';
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

function computeSdkOutPath(
    filePath: string,
    rootDir: string,
    clientOutput: string | undefined,
    commonRoot: string,
    meta: Record<string, string> = {},
): string | null {
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

function computeSdkTypeOutPath(
    filePath: string,
    rootDir: string,
    typeOutput: string,
    commonRoot: string,
    meta: Record<string, string> = {},
): string | null {
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

// ─── Prettier formatting ──────────────────────────────────────────────────

/**
 * Format generated files with the user's local prettier installation.
 * Mutates each entry's `content` in place. Silently skips if prettier is not
 * installed or if a file's content cannot be parsed by prettier.
 */
async function formatWithPrettier(
    results: { outPath: string; content: string }[],
): Promise<void> {
    let prettier: typeof import('prettier');
    try {
        prettier = await import('prettier');
    } catch {
        console.warn('  ⚠  prettier not found — skipping format step');
        return;
    }
    for (const result of results) {
        try {
            const options = await prettier.resolveConfig(result.outPath) ?? {};
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

/**
 * Returns the set of all type names needed by public (non-internal) operations,
 * expanded transitively through the DTO model graph.
 *
 * Returns null when there are no .op files (no filtering should be applied).
 */
function computePubliclyReachableTypes(
    opAsts: OpRootNode[],
    dtoAsts: DtoRootNode[],
    modelsWithInput: Set<string>,
): Set<string> | null {
    if (opAsts.length === 0) return null;

    // Collect direct type refs from all public ops
    const reachable = new Set<string>();
    for (const opAst of opAsts) {
        for (const name of collectPublicTypeNames(opAst, modelsWithInput)) {
            reachable.add(name);
        }
    }

    // Build model → dependency names map from all DTO files
    const modelDeps = new Map<string, Set<string>>();
    for (const dtoAst of dtoAsts) {
        for (const model of dtoAst.models) {
            const deps = new Set<string>();
            if (model.base) deps.add(model.base);
            if (model.type) collectTypeRefs(model.type, deps);
            for (const field of model.fields) collectTypeRefs(field.type, deps);
            modelDeps.set(model.name, deps);
        }
    }

    // BFS: expand through model dependencies
    const frontier = [...reachable];
    while (frontier.length > 0) {
        const name = frontier.pop()!;
        const baseName = name.endsWith('Input') ? name.slice(0, -5) : name;
        for (const dep of modelDeps.get(baseName) ?? []) {
            if (!reachable.has(dep)) {
                reachable.add(dep);
                frontier.push(dep);
            }
            if (modelsWithInput.has(dep)) {
                const inputDep = `${dep}Input`;
                if (!reachable.has(inputDep)) {
                    reachable.add(inputDep);
                    frontier.push(inputDep);
                }
            }
        }
    }

    return reachable;
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

        // ── Pass 1: Parse all files ─────────────────────────────────
        // allDtoInfo/allOpInfo track every file (even unchanged) for cross-file import resolution and SDK generation
        const allDtoInfo: { ast: DtoRootNode; filePath: string; outPath: string }[] = [];
        const allOpInfo: { ast: OpRootNode; filePath: string; outPath: string }[] = [];
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
                    console.log(`  -  ${outPath} (unchanged)`);
                    continue;
                }
                dtoRoots.push({ ast, filePath, outPath });
            } else {
                const ast = parseOp(source, filePath, diag);
                const outPath = computeOutPath(filePath, serverOpts, commonRoot, ast.meta);
                if (!outPath) continue;
                allOpInfo.push({ ast, filePath, outPath });
                if (!config.force && !isFileChanged(filePath, source, outPath, cache)) {
                    console.log(`  -  ${outPath} (unchanged)`);
                    continue;
                }
                opRoots.push({ ast, filePath, outPath });
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
                if (!dtoRoots.includes(info)) dtoRoots.push(info);
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
            dtoRoots.map(r => r.ast),
            opRoots.map(r => r.ast),
            diag,
            allDtoInfo.map(r => r.ast),
        );

        // ── Pass 2: Generate code ───────────────────────────────────
        const results: { outPath: string; content: string }[] = [];
        const knownSchemes = new Set(Object.keys(config.security?.schemes ?? {}));

        for (const { ast, outPath } of dtoRoots) {
            const content = generateDto(ast, { modelOutPaths, currentOutPath: outPath, modelsWithInput });
            results.push({ outPath, content });
        }

        for (const { ast, outPath } of opRoots) {
            validateOp(ast, diag);
            validateSecurity(ast, knownSchemes, diag);
            const content = generateOp(ast, {
                servicePathTemplate: config.server.routes.servicePathTemplate,
                typeImportPathTemplate: config.server.routes.typeImportPathTemplate,
                outPath,
                modelOutPaths,
                modelsWithInput,
                defaultSecurity: config.security?.default,
                securitySchemes: config.security?.schemes,
            });
            results.push({ outPath, content });
        }

        // ── SDK generation (opt-in via config.sdk) ──────────────
        const sdkClientInfos: { outPath: string; className: string; propertyName: string }[] = [];
        const sdkTypePaths: string[] = [];
        const sdkName = config.sdk?.name;
        const sdkEntryPath = config.sdk?.output
            ? join(sdkBase, resolveTemplate(config.sdk.output, { name: sdkName ?? 'sdk' }))
            : join(sdkBase, 'sdk.ts');
        const sdkOptionsPath = join(dirname(sdkEntryPath), 'sdk-options.ts');

        if (config.sdk) {
            // If sdk.types is configured, generate DTO files into the SDK package
            // and build a separate model→path map for SDK import resolution
            let sdkModelOutPaths = modelOutPaths;
            if (config.sdk.types?.output) {
                sdkModelOutPaths = new Map<string, string>();
                // Only generate type files for DTOs that are reachable from public ops.
                // Returns null when there are no .op files (generate everything).
                const publicTypes = computePubliclyReachableTypes(
                    allOpInfo.map(o => o.ast),
                    allDtoInfo.map(d => d.ast),
                    modelsWithInput,
                );
                for (const { ast, filePath } of allDtoInfo) {
                    const typeOutPath = computeSdkTypeOutPath(filePath, sdkBase, config.sdk.types.output, commonRoot, ast.meta);
                    if (!typeOutPath) continue;
                    // Skip files where no model is reachable from a public operation
                    if (publicTypes !== null && !ast.models.some(m => publicTypes.has(m.name))) continue;
                    sdkTypePaths.push(typeOutPath);
                    // Track model paths for import resolution
                    for (const model of ast.models) {
                        sdkModelOutPaths.set(model.name, typeOutPath);
                        if (modelsWithInput.has(model.name)) {
                            sdkModelOutPaths.set(`${model.name}Input`, typeOutPath);
                        }
                    }
                    // Only regenerate if source or dependencies changed
                    const source = readFileSync(filePath, 'utf-8');
                    if (!depsChanged && !config.force && !isFileChanged(filePath, source, typeOutPath, cache)) {
                        console.log(`  -  ${typeOutPath} (unchanged)`);
                        continue;
                    }
                    const content = generatePlainTypes(ast, { modelOutPaths: sdkModelOutPaths, currentOutPath: typeOutPath, modelsWithInput });
                    results.push({ outPath: typeOutPath, content });
                }
            }

            if (config.sdk.clients) {
                for (const { ast, filePath } of allOpInfo) {
                    const sdkOutPath = computeSdkOutPath(filePath, sdkBase, config.sdk.clients.output, commonRoot, ast.meta);
                    if (!sdkOutPath) continue;
                    // Skip files where every operation is internal — no public surface to expose
                    if (!hasPublicOperations(ast)) continue;
                    // Track client info for the aggregator
                    sdkClientInfos.push({
                        outPath: sdkOutPath,
                        className: deriveClientClassName(ast.file),
                        propertyName: deriveClientPropertyName(ast.file),
                    });
                    // Only regenerate if source or dependencies changed
                    const source = readFileSync(filePath, 'utf-8');
                    if (!depsChanged && !config.force && !isFileChanged(filePath, source, sdkOutPath, cache)) {
                        console.log(`  -  ${sdkOutPath} (unchanged)`);
                        continue;
                    }
                    const content = generateSdk(ast, {
                        typeImportPathTemplate: config.sdk.clients.typeImportPathTemplate ?? config.server.routes.typeImportPathTemplate,
                        outPath: sdkOutPath,
                        modelOutPaths: sdkModelOutPaths,
                        sdkOptionsPath,
                        modelsWithInput,
                        defaultSecurity: config.security?.default,
                    });
                    results.push({ outPath: sdkOutPath, content });
                }
            }

            // Generate shared sdk-options.ts
            const sdkOptionsContent = generateSdkOptions();
            if (config.force || !isContentUnchanged(sdkOptionsPath, sdkOptionsContent)) {
                results.push({ outPath: sdkOptionsPath, content: sdkOptionsContent });
            } else {
                console.log(`  -  ${sdkOptionsPath} (unchanged)`);
            }

            // Generate sdk.ts aggregator
            if (sdkClientInfos.length > 0) {
                const sdkEntryDir = dirname(sdkEntryPath);
                const clients = sdkClientInfos.map(c => {
                    let rel = relative(sdkEntryDir, c.outPath).replace(/\.ts$/, '.js');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    return { className: c.className, propertyName: c.propertyName, importPath: rel };
                });
                const sdkOptionsRel = relative(sdkEntryDir, sdkOptionsPath).replace(/\.ts$/, '.js');
                const sdkClassName = sdkName
                    ? sdkName
                          .split(/[-._\s]+/)
                          .map(s => s.charAt(0).toUpperCase() + s.slice(1))
                          .join('') + 'Sdk'
                    : 'Sdk';
                const sdkAggregatorContent = generateSdkAggregator(
                    clients,
                    sdkOptionsRel.startsWith('.') ? sdkOptionsRel : './' + sdkOptionsRel,
                    sdkClassName,
                );
                if (config.force || !isContentUnchanged(sdkEntryPath, sdkAggregatorContent)) {
                    results.push({ outPath: sdkEntryPath, content: sdkAggregatorContent });
                } else {
                    console.log(`  -  ${sdkEntryPath} (unchanged)`);
                }
            }

            // Generate SDK barrel files: per-directory type barrels + root index.ts
            const sdkSrcDir = dirname(sdkEntryPath);
            const sdkTypeBarrels = generateBarrelFiles(sdkTypePaths);
            for (const barrel of sdkTypeBarrels) {
                if (config.force || !isContentUnchanged(barrel.outPath, barrel.content)) {
                    results.push(barrel);
                } else {
                    console.log(`  -  ${barrel.outPath} (unchanged)`);
                }
            }

            const rootExports: string[] = [];
            rootExports.push(`export * from './${basename(sdkOptionsPath).replace(/\.ts$/, '.js')}';`);
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
            const rootBarrelPath = join(sdkSrcDir, 'index.ts');
            const rootBarrelContent = `// Auto-generated barrel file\n${rootExports.sort().join('\n')}\n`;
            if (config.force || !isContentUnchanged(rootBarrelPath, rootBarrelContent)) {
                results.push({ outPath: rootBarrelPath, content: rootBarrelContent });
            } else {
                console.log(`  -  ${rootBarrelPath} (unchanged)`);
            }
        }

        // ── OpenAPI generation (opt-in via config.docs.openapi) ──────
        if (config.docs?.openapi) {
            const openapiConfig = config.docs.openapi;
            const openapiBase = openapiConfig.baseDir ? resolve(config.rootDir, openapiConfig.baseDir) : config.rootDir;
            const openapiOutput = openapiConfig.output ?? 'openapi.yaml';
            const openapiOutPath = resolve(openapiBase, openapiOutput);

            // Build a fingerprint from all source file hashes + config + deps,
            // so we can skip generation entirely when nothing has changed.
            const openapiFingerprint = computeHash(
                Object.entries(newCache)
                    .filter(([k]) => !k.startsWith('__'))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => `${k}:${v}`)
                    .join('\n') +
                    '\n' +
                    JSON.stringify(openapiConfig),
            );
            newCache['__openapi__'] = openapiFingerprint;

            if (!config.force && cacheEnabled && cache['__openapi__'] === openapiFingerprint && existsSync(openapiOutPath)) {
                console.log(`  -  ${openapiOutPath} (unchanged)`);
            } else {
                const openapiContent = generateOpenApi({
                    dtoRoots: allDtoInfo.map(d => d.ast),
                    opRoots: allOpInfo.map(o => o.ast),
                    config: openapiConfig,
                    securitySchemes: config.security?.schemes,
                });
                results.push({ outPath: openapiOutPath, content: openapiContent });
            }
        }

        // ── Markdown generation (opt-in via config.docs.markdown) ──────
        if (config.docs?.markdown) {
            const mdConfig = config.docs.markdown;
            const mdBase = mdConfig.baseDir ? resolve(config.rootDir, mdConfig.baseDir) : config.rootDir;
            const mdOutput = mdConfig.output ?? 'api-reference.md';
            const mdOutPath = resolve(mdBase, mdOutput);

            const mdFingerprint = computeHash(
                Object.entries(newCache)
                    .filter(([k]) => !k.startsWith('__'))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => `${k}:${v}`)
                    .join('\n') +
                    '\n' +
                    JSON.stringify(mdConfig),
            );
            newCache['__markdown__'] = mdFingerprint;

            if (!config.force && cacheEnabled && cache['__markdown__'] === mdFingerprint && existsSync(mdOutPath)) {
                console.log(`  -  ${mdOutPath} (unchanged)`);
            } else {
                const mdContent = generateMarkdown({
                    dtoRoots: allDtoInfo.map(d => d.ast),
                    opRoots: allOpInfo.map(o => o.ast),
                    defaultSecurity: config.security?.default,
                });
                results.push({ outPath: mdOutPath, content: mdContent });
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
