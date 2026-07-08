import { resolve, join, dirname, relative, isAbsolute } from 'node:path';

/** Matches a `{var}` placeholder — used to detect whether a path template still contains one. */
export const TEMPLATE_VAR_RE = /\{\w+\}/;

/**
 * Returns true when `target` resolves outside `rootDir`. `.ck`-derived template
 * vars can steer plugin output paths, so this backstops every plugin's emitted
 * paths at the CLI write/delete sites regardless of plugin-side containment.
 */
export function isOutsideRoot(rootDir: string, target: string): boolean {
    const rel = relative(resolve(rootDir), resolve(target));
    return rel === '..' || rel.startsWith(`..${'/'}`) || rel.startsWith('..\\') || isAbsolute(rel);
}

/**
 * Assert that `target` stays within `rootDir`. Use at write sites where a path
 * escaping the project root must abort the operation rather than proceed.
 *
 * @throws if `target` resolves outside `rootDir`.
 */
export function assertWithinRoot(rootDir: string, target: string): void {
    if (isOutsideRoot(rootDir, target)) {
        throw new Error(`refusing to write outside project root: ${target}`);
    }
}

/** Expand `{key}` placeholders in `template` from `vars`; unknown keys are left as `{key}`. */
export function resolveTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/** Returns true when the last path segment looks like a filename (contains a `.`) rather than a directory. */
export function includesFilename(p: string): boolean {
    const last = p.split('/').pop() ?? '';
    return last.includes('.');
}

/** Longest directory prefix shared by every path in `files`; falls back to `rootDir` when empty. */
export function commonDir(files: string[], rootDir: string): string {
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

/**
 * Build one `index.ts` barrel per directory that re-exports every generated
 * file in it. Returns the barrel `outPath`/`content` pairs to emit.
 */
export function generateBarrelFiles(contractPaths: string[]): { outPath: string; content: string }[] {
    const byDir = new Map<string, string[]>();
    for (const outPath of contractPaths) {
        const dir = dirname(outPath);
        const group = byDir.get(dir) ?? [];
        group.push(outPath);
        byDir.set(dir, group);
    }
    const results: { outPath: string; content: string }[] = [];
    for (const [dir, files] of byDir) {
        const exports = files
            .map(f => `export * from './${f.split('/').pop()!.replace(/\.ts$/, '.js')}';`)
            .sort()
            .join('\n');
        results.push({ outPath: join(dir, 'index.ts'), content: `// Auto-generated barrel file\n${exports}\n` });
    }
    return results;
}
