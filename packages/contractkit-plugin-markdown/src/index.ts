import { resolve } from 'node:path';
import { generateMarkdown } from './codegen-markdown.js';
import type { ContractKitPlugin } from '@maroonedsoftware/contractkit';

export interface MarkdownPluginConfig {
    baseDir?: string;
    output?: string;
}

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
