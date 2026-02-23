#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { glob } from 'glob';
import { DiagnosticCollector } from './diagnostics.js';
import { parseDto } from './parser-dto.js';
import { parseOp } from './parser-op.js';
import { generateDto } from './codegen-dto.js';
import { generateOp } from './codegen-op.js';

// ─── Arg parsing ───────────────────────────────────────────────────────────

interface CliArgs {
  patterns: string[];
  outDir?: string;
  watch: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const patterns: string[] = [];
  let outDir: string | undefined;
  let watch = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--out-dir' || arg === '-o') {
      outDir = args[++i];
    } else if (arg === '--watch' || arg === '-w') {
      watch = true;
    } else if (!arg.startsWith('--')) {
      patterns.push(arg);
    }
  }

  return { patterns, outDir, watch };
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

// ─── Compilation ───────────────────────────────────────────────────────────

function compileFile(
  filePath: string,
  outDir: string | undefined,
  rootDir: string,
  diag: DiagnosticCollector,
): { outPath: string; content: string } | null {
  const source = readFileSync(filePath, 'utf-8');
  const ext = filePath.endsWith('.dto') ? 'dto' : filePath.endsWith('.op') ? 'op' : null;

  if (!ext) {
    diag.warn(filePath, 0, `Skipping unknown file extension`);
    return null;
  }

  let content: string;

  if (ext === 'dto') {
    const ast = parseDto(source, filePath, diag);
    if (diag.hasErrors()) return null;
    content = generateDto(ast);
  } else {
    const ast = parseOp(source, filePath, diag);
    if (diag.hasErrors()) return null;
    content = generateOp(ast);
  }

  const baseName = filePath.split('/').pop()!;
  const outName = ext === 'dto'
    ? baseName.replace(/\.dto$/, '.dto.ts')
    : baseName.replace(/\.op$/, '.router.ts');

  let outPath: string;
  if (outDir) {
    // Preserve subdirectory structure relative to rootDir
    const relDir = relative(rootDir, dirname(filePath));
    outPath = join(resolve(outDir), relDir, outName);
  } else {
    outPath = join(dirname(filePath), outName);
  }

  return { outPath, content };
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
  const args = parseArgs(process.argv);

  if (args.patterns.length === 0) {
    console.error('Usage: dsl-compile [files/globs...] [--out-dir <path>] [--watch]');
    console.error('');
    console.error('Examples:');
    console.error('  dsl-compile src/contracts/**/*.dto --out-dir dist/types');
    console.error('  dsl-compile user.dto ledger.op --out-dir out');
    process.exit(1);
  }

  const run = async () => {
    const files = await resolveFiles(args.patterns);

    if (files.length === 0) {
      console.warn('No matching files found for patterns:', args.patterns.join(', '));
      return;
    }

    const diag = new DiagnosticCollector();
    const results: { outPath: string; content: string }[] = [];
    const rootDir = commonDir(files);

    for (const file of files) {
      const result = compileFile(file, args.outDir, rootDir, diag);
      if (result) results.push(result);
    }

    diag.report();

    if (diag.hasErrors()) {
      console.error('\nCompilation failed.');
      process.exitCode = 1;
      return;
    }

    // Write output files
    if (args.outDir) {
      mkdirSync(resolve(args.outDir), { recursive: true });
    }

    for (const { outPath, content } of results) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, content, 'utf-8');
      console.log(`  ✓  ${relative(process.cwd(), outPath)}`);
    }

    console.log(`\nCompiled ${results.length} file(s).`);
  };

  await run();

  if (args.watch) {
    const { watch } = await import('node:fs');
    const allDirs = new Set(
      (await resolveFiles(args.patterns)).map(f => dirname(f))
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
