import { isAbsolute, relative, sep } from 'node:path';
import { generateMintlify, resolveLayout as resolveMintlifyLayout, type SharedSpec } from './targets/mintlify/index.js';
import markdown from './targets/markdown/index.js';
import openapi, { buildSpec as buildOpenApiSpec, resolveLayout as resolveOpenApiLayout } from './targets/openapi/index.js';
import type { ContractKitPlugin, PluginContext } from '@contractkit/core';
import type { DocsPluginConfig, GenerateInputs } from './target.js';

export type { DocsPluginConfig, DocsTarget, DocsTargetName, MarkdownConfig, MintlifyConfig, OpenApiTargetConfig } from './target.js';
export { generateOpenApi, buildOpenApiDocument, toYaml, scalarToSchema } from './targets/openapi/codegen.js';
export { generateMarkdown, renderTsScalar } from './targets/markdown/codegen.js';
export type { MarkdownCodegenContext } from './targets/markdown/codegen.js';
export type { OpenApiConfig, OpenApiServerEntry, OpenApiSecurityScheme, OpenApiCodegenContext } from './targets/openapi/codegen.js';
export { slugify, titleCase, humanize, deriveTitle, derivePageSlug, groupEndpoints, groupModels, computePubliclyReachableModels } from './naming.js';
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

    if (config.openapi) {
        await openapi.generate(inputs, ctx, config.openapi, rootDir);
        ran = true;
    }

    if (config.mintlify) {
        await generateMintlify(inputs, ctx, config.mintlify, rootDir, resolveSharedSpec(inputs, config, rootDir));
        ran = true;
    }

    if (config.markdown) {
        await markdown.generate(inputs, ctx, config.markdown, rootDir);
        ran = true;
    }

    if (!ran) {
        throw new Error(`@contractkit/plugin-docs: no target configured. Add at least one of: ${TARGET_NAMES.join(', ')}.`);
    }
}

/**
 * Decide whether the Mintlify target can reference the spec the `openapi` target emitted.
 *
 * It can only do so when that spec lands inside the docs folder: the `openapi:` frontmatter path
 * is resolved relative to the docs root, so a spec written anywhere else is unreachable from a
 * page. When it is reachable, one spec is emitted instead of two and both targets read the same
 * `info` / `servers` / `securitySchemes`.
 */
function resolveSharedSpec(inputs: GenerateInputs, config: DocsPluginConfig, rootDir: string): SharedSpec | undefined {
    if (!config.openapi || !config.mintlify) return undefined;

    const docsRoot = resolveMintlifyLayout(config.mintlify, rootDir).baseDir;
    const specPath = resolveOpenApiLayout(config.openapi, rootDir).outPath;

    // `relative` yields a `..`-prefixed or absolute path when the spec sits outside the docs root.
    const rel = relative(docsRoot, specPath);
    const inside = rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
    if (!inside) return undefined;

    return { specPath: `/${rel.split(sep).join('/')}`, doc: buildOpenApiSpec(inputs, config.openapi) };
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
