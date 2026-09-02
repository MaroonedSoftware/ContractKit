import mintlify from './targets/mintlify/index.js';
import type { ContractKitPlugin, PluginContext } from '@contractkit/core';
import type { DocsPluginConfig, DocsTarget, DocsTargetName, GenerateInputs } from './target.js';

export type { DocsPluginConfig, DocsTarget, DocsTargetName } from './target.js';
export { slugify, titleCase, humanize, deriveTitle, derivePageSlug, groupEndpoints, groupModels } from './naming.js';
export type { EndpointEntry, EndpointGroup, ModelEntry, ModelGroup } from './naming.js';

/** Every documentation platform this plugin can emit for, keyed by config value. */
const TARGETS: Record<DocsTargetName, DocsTarget> = {
    mintlify,
};

const DEFAULT_TARGET: DocsTargetName = 'mintlify';

/**
 * Look up the configured target. An unknown value throws rather than falling back to the
 * default: a typo in `target` would otherwise silently emit a docs site for the wrong platform.
 */
function resolveTarget(config: DocsPluginConfig): DocsTarget {
    const name = config.target ?? DEFAULT_TARGET;
    const target = TARGETS[name];
    if (!target) {
        const supported = Object.keys(TARGETS).join(', ');
        throw new Error(`@contractkit/plugin-docs: unknown target "${name}". Supported targets: ${supported}`);
    }
    return target;
}

function run(inputs: GenerateInputs, ctx: PluginContext, config: DocsPluginConfig, rootDir: string): void {
    resolveTarget(config).generate(inputs, ctx, config, rootDir);
}

// ─── Default export: loaded via plugins config, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'docs',
    cacheKey: 'docs',
    async generateTargets(inputs, ctx) {
        run(inputs, ctx, ctx.options as DocsPluginConfig, ctx.rootDir);
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createDocsPlugin(config: DocsPluginConfig, rootDir: string): ContractKitPlugin {
    return {
        name: 'docs',
        cacheKey: `docs:${JSON.stringify(config)}`,
        async generateTargets(inputs, ctx) {
            run(inputs, ctx, config, rootDir);
        },
    };
}
