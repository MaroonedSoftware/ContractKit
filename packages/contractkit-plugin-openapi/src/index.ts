import { resolve } from 'node:path';
import { generateOpenApi } from './codegen-openapi.js';
import type { ContractKitPlugin } from '@contractkit/core';
import type { OpenApiConfig, OpenApiSecurityScheme } from './codegen-openapi.js';
export type { OpenApiServerEntry, OpenApiConfig, OpenApiSecurityScheme } from './codegen-openapi.js';

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
            const content = generateOpenApi({ contractRoots, opRoots, config: openapiConfig, securitySchemes });
            ctx.emitFile(outPath, content);
        },
    };
}
