import { resolve } from 'node:path';
import { generateMarkdown } from './codegen-markdown.js';
import type { ContractKitPlugin } from '@maroonedsoftware/contractkit';

export interface MarkdownPluginConfig {
    baseDir?: string;
    output?: string;
}

// ─── Default export: loaded via plugins array, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'markdown',
    cacheKey: 'markdown',
    async generateTargets({ contractRoots, opRoots }, ctx) {
        const config = ctx.options as MarkdownPluginConfig;
        const base = config.baseDir ? resolve(ctx.rootDir, config.baseDir) : ctx.rootDir;
        const outPath = resolve(base, config.output ?? 'api-reference.md');
        ctx.emitFile(outPath, generateMarkdown({ contractRoots, opRoots }));
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createMarkdownPlugin(config: MarkdownPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'markdown',
        cacheKey: `markdown:${JSON.stringify(config)}`,
        async generateTargets({ contractRoots, opRoots }, ctx) {
            const base = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
            const outPath = resolve(base, config.output ?? 'api-reference.md');
            ctx.emitFile(outPath, generateMarkdown({ contractRoots, opRoots }));
        },
    };
}
