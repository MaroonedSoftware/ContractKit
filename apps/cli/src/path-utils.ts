import { resolve, join, relative, dirname } from 'node:path';

export const TEMPLATE_VAR_RE = /\{\w+\}/;

export function resolveTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

export function includesFilename(p: string): boolean {
    const last = p.split('/').pop() ?? '';
    return last.includes('.');
}

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

