import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { buildOnce } from './harness.js';

/**
 * Whether the generated TypeScript compiles. `toContain` assertions cannot see this: most of the
 * defects below produce a file that reads correctly line by line and fails only as a whole.
 *
 * The diagnostics are **snapshotted, not asserted empty**. Asserting `toEqual([])` today would
 * land a red test; recording them instead means each later fix shrinks this file, and the
 * shrinking snapshot is the progress indicator. The last phase of the batch flips it.
 *
 * Server and SDK output are checked as two separate programs, because they compile under
 * genuinely different assumptions: the server is a Node application and may refer to `Buffer`,
 * while the SDK is the package the `scaffold: true` `package.json` describes, which declares no
 * `@types/node`. Checking them together would either excuse a real defect in the SDK or invent
 * one in the server.
 */

const testsDir = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

/** Package roots for the dependencies we resolve for real rather than stub. */
const ZOD_DIR = dirname(require_.resolve('zod/package.json'));
const TYPES_NODE_DIR = dirname(require_.resolve('@types/node/package.json'));

function compilerOptions(withNodeTypes: boolean): ts.CompilerOptions {
    return {
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noUncheckedIndexedAccess: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        skipLibCheck: true,
        noEmit: true,
        types: withNodeTypes ? ['node'] : [],
    };
}

const { files } = await buildOnce();

/**
 * Materialise one subtree of the emitted TypeScript on disk so relative imports between the files
 * resolve, alongside a `node_modules` holding the dependencies that are resolved for real.
 */
function materialise(prefix: string, withNodeTypes: boolean): { dir: string; rootNames: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'ck-typecheck-'));
    const rootNames: string[] = [];

    for (const [relPath, content] of files.typescript) {
        if (!relPath.startsWith(prefix) || !relPath.endsWith('.ts')) continue;
        const outPath = join(dir, relPath);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, content, 'utf-8');
        rootNames.push(outPath);
    }

    const ambientPath = join(dir, 'ambient.d.ts');
    copyFileSync(resolve(testsDir, 'ambient.d.ts'), ambientPath);
    rootNames.push(ambientPath);

    // `type: module` so NodeNext resolves the generated `.js` specifiers as ESM.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'generated', type: 'module' }), 'utf-8');

    // Real `zod`, because the emitted type aliases are `z.infer<...>` over the emitted schemas —
    // a stub would make every one of them vacuously `any` and the check vacuously pass.
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    symlinkSync(ZOD_DIR, join(dir, 'node_modules', 'zod'));
    if (withNodeTypes) {
        mkdirSync(join(dir, 'node_modules', '@types'), { recursive: true });
        symlinkSync(TYPES_NODE_DIR, join(dir, 'node_modules', '@types', 'node'));
    }

    return { dir, rootNames };
}

/** Render diagnostics as stable snapshot text: code, file, and message, sorted, no line numbers. */
function formatDiagnostics(diagnostics: readonly ts.Diagnostic[], dir: string): string {
    if (diagnostics.length === 0) return '(no diagnostics)\n';
    return (
        diagnostics
            .map(d => {
                const file = d.file ? relative(dir, d.file.fileName).split(sep).join('/') : '(no file)';
                return `TS${d.code} ${file}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
            })
            .sort()
            .join('\n') + '\n'
    );
}

function check(prefix: string, withNodeTypes: boolean): string {
    const { dir, rootNames } = materialise(prefix, withNodeTypes);
    const program = ts.createProgram(rootNames, compilerOptions(withNodeTypes));
    return formatDiagnostics(ts.getPreEmitDiagnostics(program), dir);
}

describe('generated TypeScript', () => {
    it('records the SDK compiler diagnostics as a baseline', async () => {
        await expect(check('sdk/', false)).toMatchFileSnapshot('./__snapshots__/_typecheck-sdk.txt');
    });

    it('records the server compiler diagnostics as a baseline', async () => {
        await expect(check('server/', true)).toMatchFileSnapshot('./__snapshots__/_typecheck-server.txt');
    });
});
