import { resolve } from 'node:path';
import { generateMarkdown } from './codegen.js';
import type { DocsTarget, GenerateInputs, MarkdownConfig } from '../../target.js';
import type { PluginContext } from '@contractkit/core';

/**
 * The Markdown target.
 *
 * Emits one self-contained API reference document. Unlike the Mintlify target, whose pages are
 * frontmatter that only becomes readable after a site build, this output is meant to be read raw:
 * it renders on GitHub, greps, and diffs in a pull request with no build step and no hosting.
 */

/** Resolved output location for the reference document. */
export interface MarkdownLayout {
    outPath: string;
    baseDir: string;
}

export function resolveLayout(config: MarkdownConfig, rootDir: string): MarkdownLayout {
    const baseDir = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
    return { baseDir, outPath: resolve(baseDir, config.output ?? 'api-reference.md') };
}

const target: DocsTarget<MarkdownConfig> = {
    name: 'markdown',
    async generate(inputs: GenerateInputs, ctx: PluginContext, config: MarkdownConfig, rootDir: string): Promise<void> {
        const content = generateMarkdown({
            contractRoots: inputs.contractRoots,
            opRoots: inputs.opRoots,
            includeInternal: config.includeInternal,
        });
        ctx.emitFile(resolveLayout(config, rootDir).outPath, content);
    },
};

export default target;
