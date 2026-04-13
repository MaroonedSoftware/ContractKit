import { resolve, join, relative, dirname } from 'node:path';
import type { ContractRootNode, OpRootNode } from '@maroonedsoftware/contractkit';
import { collectTypeRefs, collectPublicTypeNames } from '@maroonedsoftware/contractkit';

export const TEMPLATE_VAR_RE = /\{\w+\}/;

export function resolveTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function includesFilename(p: string): boolean {
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
            if (p[i] !== first[i]) { depth = i; break; }
        }
    }
    return first.slice(0, depth).join('/') || '/';
}

export function computeSdkOutPath(
    filePath: string,
    rootDir: string,
    clientOutput: string | undefined,
    commonRoot: string,
    meta: Record<string, string> = {},
): string | null {
    if (!filePath.endsWith('.ck')) return null;
    const baseName = filePath.split('/').pop()!;
    const defaultOutName = baseName.replace(/\.ck$/, '.client.ts');
    const baseOutDir = resolve(rootDir);
    const relDir = relative(commonRoot, dirname(filePath));
    const filename = baseName.replace(/\.ck$/, '');

    if (clientOutput && TEMPLATE_VAR_RE.test(clientOutput)) {
        const resolved = resolveTemplate(clientOutput, { filename, dir: relDir, ext: 'ck', ...meta });
        if (includesFilename(resolved)) return join(baseOutDir, resolved);
        return join(baseOutDir, resolved, defaultOutName);
    }
    if (clientOutput) {
        if (includesFilename(clientOutput)) return join(baseOutDir, clientOutput);
        return join(baseOutDir, clientOutput, relDir, defaultOutName);
    }
    return join(baseOutDir, relDir, defaultOutName);
}

export function computeSdkTypeOutPath(
    filePath: string,
    rootDir: string,
    typeOutput: string,
    commonRoot: string,
    meta: Record<string, string> = {},
): string | null {
    if (!filePath.endsWith('.ck')) return null;
    const baseName = filePath.split('/').pop()!;
    const defaultOutName = baseName.replace(/\.ck$/, '.ts');
    const baseOutDir = resolve(rootDir);
    const relDir = relative(commonRoot, dirname(filePath));
    const filename = baseName.replace(/\.ck$/, '');

    if (TEMPLATE_VAR_RE.test(typeOutput)) {
        const resolved = resolveTemplate(typeOutput, { filename, dir: relDir, ext: 'ck', ...meta });
        if (includesFilename(resolved)) return join(baseOutDir, resolved);
        return join(baseOutDir, resolved, defaultOutName);
    }
    if (includesFilename(typeOutput)) return join(baseOutDir, typeOutput);
    return join(baseOutDir, typeOutput, relDir, defaultOutName);
}

export function generateBarrelFiles(dtoPaths: string[]): { outPath: string; content: string }[] {
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
            .map(f => `export * from './${f.split('/').pop()!.replace(/\.ts$/, '.js')}';`)
            .sort()
            .join('\n');
        results.push({ outPath: join(dir, 'index.ts'), content: `// Auto-generated barrel file\n${exports}\n` });
    }
    return results;
}

export function computePubliclyReachableTypes(
    opAsts: OpRootNode[],
    dtoAsts: ContractRootNode[],
    modelsWithInput: Set<string>,
): Set<string> | null {
    if (opAsts.length === 0) return null;
    const reachable = new Set<string>();
    for (const opAst of opAsts) {
        for (const name of collectPublicTypeNames(opAst, modelsWithInput)) reachable.add(name);
    }
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
    const frontier = [...reachable];
    while (frontier.length > 0) {
        const name = frontier.pop()!;
        const baseName = name.endsWith('Input') ? name.slice(0, -5) : name;
        for (const dep of modelDeps.get(baseName) ?? []) {
            if (!reachable.has(dep)) { reachable.add(dep); frontier.push(dep); }
            if (modelsWithInput.has(dep)) {
                const inputDep = `${dep}Input`;
                if (!reachable.has(inputDep)) { reachable.add(inputDep); frontier.push(inputDep); }
            }
        }
    }
    return reachable;
}
