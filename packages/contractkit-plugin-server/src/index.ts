import { resolve, join, relative, dirname } from 'node:path';
import { generateOp } from '@maroonedsoftware/contractkit';
import type { ContractKitPlugin } from '@maroonedsoftware/contractkit';

export interface ServerPluginConfig {
    baseDir?: string;
    output?: string;
    servicePathTemplate?: string;
    typeImportPathTemplate?: string;
}

// ─── Path utilities ────────────────────────────────────────────────────────

const TEMPLATE_VAR_RE = /\{\w+\}/;

function resolveTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function includesFilename(p: string): boolean {
    const last = p.split('/').pop() ?? '';
    return last.includes('.');
}

function commonDir(files: string[], rootDir: string): string {
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

function computeServerRoutesOutPath(
    filePath: string,
    serverBase: string,
    output: string | undefined,
    commonRoot: string,
    meta: Record<string, string> = {},
): string {
    const baseName = filePath.split('/').pop()!;
    const relDir = relative(commonRoot, dirname(filePath));
    const filename = baseName.replace(/\.ck$/, '');
    const defaultName = `${filename}.router.ts`;
    const baseOutDir = resolve(serverBase);

    if (output && TEMPLATE_VAR_RE.test(output)) {
        const resolved = resolveTemplate(output, { filename, dir: relDir, ext: 'ck', ...meta });
        if (includesFilename(resolved)) return join(baseOutDir, resolved);
        return join(baseOutDir, resolved, defaultName);
    }
    if (output) {
        if (includesFilename(output)) return join(baseOutDir, output);
        return join(baseOutDir, output, relDir, defaultName);
    }
    return join(baseOutDir, relDir, defaultName);
}

// ─── Shared generateTargets implementation ─────────────────────────────────

function buildGenerateTargets(config: ServerPluginConfig, rootDir: string): ContractKitPlugin['generateTargets'] {
    const serverBase = resolve(rootDir, config.baseDir ?? '.');
    return async function ({ contractRoots, opRoots, modelOutPaths, modelsWithInput }, ctx) {
        const allFiles = [...contractRoots.map(r => r.file), ...opRoots.map(r => r.file)];
        const commonRoot = commonDir(allFiles, ctx.rootDir);

        for (const ast of opRoots) {
            const outPath = computeServerRoutesOutPath(ast.file, serverBase, config.output, commonRoot, ast.meta);
            const content = generateOp(ast, {
                servicePathTemplate: config.servicePathTemplate,
                typeImportPathTemplate: config.typeImportPathTemplate,
                outPath,
                modelOutPaths: modelOutPaths as Map<string, string>,
                modelsWithInput: modelsWithInput as Set<string>,
            });
            ctx.emitFile(outPath, content);
        }
    };
}

// ─── Default export: loaded via plugins array, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'server',
    cacheKey: 'server',
    async generateTargets(inputs, ctx) {
        const config = ctx.options as ServerPluginConfig;
        await buildGenerateTargets(config, ctx.rootDir)!(inputs, ctx);
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createServerPlugin(config: ServerPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'server',
        cacheKey: `server:${JSON.stringify(config)}`,
        generateTargets: buildGenerateTargets(config, rootDir),
    };
}
