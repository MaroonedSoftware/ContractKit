import mintlify from './targets/mintlify/index.js';
import markdown from './targets/markdown/index.js';
import openapi from './targets/openapi/index.js';
import type { ContractKitPlugin, PluginContext } from '@contractkit/core';
import type { DocsPluginConfig, GenerateInputs } from './target.js';

export type { DocsPluginConfig, DocsTarget, DocsTargetName, MarkdownConfig, MintlifyConfig, OpenApiTargetConfig } from './target.js';
export { generateOpenApi, buildOpenApiDocument, toYaml, scalarToSchema } from './targets/openapi/codegen.js';
export { generateMarkdown, renderTsScalar } from './targets/markdown/codegen.js';
export type { MarkdownCodegenContext } from './targets/markdown/codegen.js';
export type { OpenApiConfig, OpenApiServerEntry, OpenApiSecurityScheme, OpenApiCodegenContext } from './targets/openapi/codegen.js';
export { slugify, titleCase, humanize, deriveTitle, derivePageSlug, groupEndpoints, groupModels } from './naming.js';
export type { EndpointEntry, EndpointGroup, ModelEntry, ModelGroup } from './naming.js';

/** Config keys that name a target, for the "nothing configured" error message. */
const TARGET_NAMES = ['mintlify', 'markdown', 'openapi'] as const;

/**
 * Run every target the config turns on.
 *
 * Targets are enabled by being present, the same way `@contractkit/plugin-typescript` enables its
 * `server` / `sdk` / `zod` / `types` / `mcp` sub-generators. A config naming no target at all is a
 * mistake worth failing on: the plugin would otherwise load and silently emit nothing.
 */
async function run(inputs: GenerateInputs, ctx: PluginContext, config: DocsPluginConfig, rootDir: string): Promise<void> {
    let ran = false;

    if (config.mintlify) {
        await mintlify.generate(inputs, ctx, config.mintlify, rootDir);
        ran = true;
    }

    if (config.markdown) {
        await markdown.generate(inputs, ctx, config.markdown, rootDir);
        ran = true;
    }

    if (config.openapi) {
        await openapi.generate(inputs, ctx, config.openapi, rootDir);
        ran = true;
    }

    if (!ran) {
        throw new Error(`@contractkit/plugin-docs: no target configured. Add at least one of: ${TARGET_NAMES.join(', ')}.`);
    }
}

// ─── Default export: loaded via plugins config, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'docs',
    cacheKey: 'docs',
    async generateTargets(inputs, ctx) {
        await run(inputs, ctx, ctx.options as DocsPluginConfig, ctx.rootDir);
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createDocsPlugin(config: DocsPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'docs',
        cacheKey: `docs:${JSON.stringify(config)}`,
        async generateTargets(inputs, ctx) {
            await run(inputs, ctx, config, rootDir);
        },
    };
}
