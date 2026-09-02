import { resolve } from 'node:path';
import { buildOpenApiDocument, toYaml } from '@contractkit/plugin-openapi';
import { collectModels, groupEndpoints } from '../../naming.js';
import { renderEndpointPage, renderModelPage } from './pages.js';
import type { DocsPluginConfig, DocsTarget, GenerateInputs } from '../../target.js';
import type { PluginContext } from '@contractkit/core';

/**
 * The Mintlify target.
 *
 * Emits a docs folder Mintlify can serve as-is: an OpenAPI document, one MDX page per endpoint,
 * and one per documented model. The pages carry only frontmatter and prose — Mintlify renders
 * everything else from the spec.
 */

/** Resolved directory and file layout, so the emit code isn't re-deriving defaults inline. */
export interface MintlifyLayout {
    /** Absolute docs root. */
    baseDir: string;
    /** Endpoint page directory, relative to the docs root. */
    apiDir: string;
    /** Model page directory, relative to the docs root. */
    modelsDir: string;
    /** Spec filename relative to the docs root, e.g. `openapi.yaml`. */
    specFile: string;
    /** Docs-root-absolute spec reference used in frontmatter, e.g. `/openapi.yaml`. */
    specPath: string;
}

/** Strip leading and trailing slashes so a configured directory joins predictably. */
function normalizeDir(value: string): string {
    return value.replace(/^\/+|\/+$/g, '');
}

export function resolveLayout(config: DocsPluginConfig, rootDir: string): MintlifyLayout {
    const baseDir = resolve(rootDir, config.baseDir ?? 'docs');
    const apiDir = normalizeDir(config.apiDir ?? 'api-reference');
    const modelsDir = normalizeDir(config.modelsDir ?? `${apiDir}/models`);
    const specFile = normalizeDir(config.openapi?.output ?? 'openapi.yaml');
    return { baseDir, apiDir, modelsDir, specFile, specPath: `/${specFile}` };
}

/**
 * Build the OpenAPI document the pages reference.
 *
 * `baseDir` and `output` are dropped from the OpenAPI config on the way through: this plugin
 * owns where the spec lands, and letting the nested config redirect it would leave every page's
 * frontmatter pointing at a file that isn't there.
 */
export function buildSpec(inputs: GenerateInputs, config: DocsPluginConfig): Record<string, unknown> {
    const { info, servers, security, securitySchemes } = config.openapi ?? {};
    return buildOpenApiDocument({
        contractRoots: inputs.contractRoots,
        opRoots: inputs.opRoots,
        config: { info, servers, security, includeInternal: config.includeInternal ?? false },
        securitySchemes,
    });
}

/** The schema names the spec actually contains — the set of models worth giving a page. */
export function schemaNames(doc: Record<string, unknown>): Set<string> {
    const components = doc.components as { schemas?: Record<string, unknown> } | undefined;
    return new Set(Object.keys(components?.schemas ?? {}));
}

const target: DocsTarget = {
    name: 'mintlify',
    generate(inputs: GenerateInputs, ctx: PluginContext, config: DocsPluginConfig, rootDir: string): void {
        const layout = resolveLayout(config, rootDir);
        const spec = buildSpec(inputs, config);

        ctx.emitFile(resolve(layout.baseDir, layout.specFile), toYaml(spec));

        for (const group of groupEndpoints(inputs.opRoots, config.includeInternal)) {
            for (const entry of group.endpoints) {
                const path = resolve(layout.baseDir, layout.apiDir, group.slug, `${entry.slug}.mdx`);
                ctx.emitFile(path, renderEndpointPage(entry, layout.specPath));
            }
        }

        if (config.modelPages !== false) {
            for (const entry of collectModels(inputs.contractRoots, schemaNames(spec))) {
                const path = resolve(layout.baseDir, layout.modelsDir, `${entry.slug}.mdx`);
                ctx.emitFile(path, renderModelPage(entry, layout.specPath));
            }
        }
    },
};

export default target;
