/**
 * @deprecated Superseded by `@contractkit/plugin-docs`, which emits this spec as its `openapi`
 * target alongside the Markdown and Mintlify ones. This package is now a thin re-export and will
 * be removed in a future major; move your config to:
 *
 * ```json
 * "@contractkit/plugin-docs": { "openapi": { "output": "openapi.yaml" } }
 * ```
 */
import { resolve } from 'node:path';
import { generateOpenApi } from '@contractkit/plugin-docs';
import type { ContractKitPlugin } from '@contractkit/core';
import type { OpenApiConfig, OpenApiSecurityScheme } from '@contractkit/plugin-docs';

export type { OpenApiServerEntry, OpenApiConfig, OpenApiSecurityScheme, OpenApiCodegenContext } from '@contractkit/plugin-docs';
export { generateOpenApi, buildOpenApiDocument, toYaml } from '@contractkit/plugin-docs';

export interface OpenApiPluginOptions extends OpenApiConfig {
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
}

// ─── Default export: loaded via plugins array, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'openapi',
    cacheKey: 'openapi',
    async generateTargets({ contractRoots, opRoots }, ctx) {
        const { securitySchemes, ...openapiConfig } = ctx.options as OpenApiPluginOptions;
        const base = openapiConfig.baseDir ? resolve(ctx.rootDir, openapiConfig.baseDir) : ctx.rootDir;
        const outPath = resolve(base, openapiConfig.output ?? 'openapi.yaml');
        ctx.emitFile(outPath, generateOpenApi({ contractRoots, opRoots, config: openapiConfig, securitySchemes }));
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createOpenApiPlugin(
    openapiConfig: OpenApiConfig,
    rootDir: string,
    securitySchemes?: Record<string, OpenApiSecurityScheme>,
): ContractKitPlugin {
    return {
        name: 'openapi',
        cacheKey: `openapi:${JSON.stringify(openapiConfig)}`,
        async generateTargets({ contractRoots, opRoots }, ctx) {
            const base = openapiConfig.baseDir ? resolve(rootDir, openapiConfig.baseDir) : rootDir;
            const outPath = resolve(base, openapiConfig.output ?? 'openapi.yaml');
            ctx.emitFile(outPath, generateOpenApi({ contractRoots, opRoots, config: openapiConfig, securitySchemes }));
        },
    };
}
