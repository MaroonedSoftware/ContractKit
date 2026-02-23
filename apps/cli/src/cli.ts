#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { glob } from 'glob';
import { DiagnosticCollector } from './diagnostics.js';
import { parseDto } from './parser-dto.js';
import { parseOp } from './parser-op.js';
import { generateDto } from './codegen-dto.js';
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
  patterns: string[];
  outDir?: string;
  watch: boolean;
  servicePath?: string;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const patterns: string[] = [];
  let outDir: string | undefined;
  let watch = false;
  let servicePath: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--out-dir' || arg === '-o') {
      outDir = args[++i];
    } else if (arg === '--watch' || arg === '-w') {
      watch = true;
    } else if (arg === '--service-path') {
      servicePath = args[++i];
    } else if (arg === '--force') {
      force = true;
    } else if (!arg.startsWith('--')) {
      patterns.push(arg);
    }
  }

  return { patterns, outDir, watch, servicePath, force };
}

// ─── File resolution ───────────────────────────────────────────────────────

async function resolveFiles(patterns: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { absolute: true });
    files.push(...matches);
  }
  return [...new Set(files)];
}

// ─── Output path computation ──────────────────────────────────────────────

function computeOutPath(filePath: string, outDir: string | undefined, rootDir: string): string | null {
  const ext = filePath.endsWith('.dto') ? 'dto' : filePath.endsWith('.op') ? 'op' : null;
  if (!ext) return null;

  const baseName = filePath.split('/').pop()!;
  const outName = ext === 'dto'
    ? baseName.replace(/\.dto$/, '.dto.ts')
    : baseName.replace(/\.op$/, '.router.ts');

  if (outDir) {
    const relDir = relative(rootDir, dirname(filePath));
    return join(resolve(outDir), relDir, outName);
  }
  return join(dirname(filePath), outName);
}

/** Find the longest common directory prefix of a list of absolute paths. */
function commonDir(files: string[]): string {
  if (files.length === 0) return process.cwd();
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
  const fileConfig = loadConfig();
  const config = mergeConfig(fileConfig, cliArgs);

  if (config.patterns.length === 0) {
    console.error('Usage: dsl-compile [files/globs...] [--out-dir <path>] [--watch] [--service-path <template>] [--force]');
    console.error('');
    console.error('Examples:');
    console.error('  dsl-compile src/contracts/**/*.dto --out-dir dist/types');
    console.error('  dsl-compile user.dto ledger.op --out-dir out');
    console.error('  dsl-compile --service-path "#services/{kebab}.service.js"');
    console.error('');
    console.error('Also reads from contract-dsl.config.json if present.');
    process.exit(1);
  }

  const run = async () => {
    const files = await resolveFiles(config.patterns);

    if (files.length === 0) {
      console.warn('No matching files found for patterns:', config.patterns.join(', '));
      return;
    }

    const diag = new DiagnosticCollector();
    const rootDir = commonDir(files);
    const cache: FileHashMap = config.force || !config.outDir ? {} : loadCache(config.outDir);
    const newCache: FileHashMap = {};

    // ── Pass 1: Parse all files ─────────────────────────────────
    const dtoRoots: { ast: DtoRootNode; filePath: string; outPath: string }[] = [];
    const opRoots: { ast: OpRootNode; filePath: string; outPath: string }[] = [];

    for (const filePath of files) {
      const ext = filePath.endsWith('.dto') ? 'dto' : filePath.endsWith('.op') ? 'op' : null;
      if (!ext) {
        diag.warn(filePath, 0, `Skipping unknown file extension`);
        continue;
      }

      const outPath = computeOutPath(filePath, config.outDir, rootDir);
      if (!outPath) continue;

      const source = readFileSync(filePath, 'utf-8');
      const hash = computeHash(source);
      newCache[filePath] = hash;

      // Incremental: skip unchanged files
      if (!config.force && !isFileChanged(filePath, source, outPath, cache)) {
        console.log(`  -  ${relative(process.cwd(), outPath)} (unchanged)`);
        continue;
      }

      if (ext === 'dto') {
        const ast = parseDto(source, filePath, diag);
        dtoRoots.push({ ast, filePath, outPath });
      } else {
        const ast = parseOp(source, filePath, diag);
        opRoots.push({ ast, filePath, outPath });
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
      const content = generateDto(ast);
      results.push({ outPath, content });
    }

    for (const { ast, outPath } of opRoots) {
      validateOp(ast, diag);
      const content = generateOp(ast, {
        servicePathTemplate: config.servicePathTemplate,
        typeImportPathTemplate: config.typeImportPathTemplate,
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
    if (config.outDir) {
      mkdirSync(resolve(config.outDir), { recursive: true });
    }

    for (const { outPath, content } of results) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, content, 'utf-8');
      console.log(`  ✓  ${relative(process.cwd(), outPath)}`);
    }

    // Save cache
    if (config.outDir) {
      saveCache(config.outDir, newCache);
    }

    console.log(`\nCompiled ${results.length} file(s).`);
  };

  await run();

  if (config.watch) {
    const { watch } = await import('node:fs');
    const allDirs = new Set(
      (await resolveFiles(config.patterns)).map(f => dirname(f))
    );
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
