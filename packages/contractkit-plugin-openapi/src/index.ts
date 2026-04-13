import { resolve } from 'node:path';
import { generateOpenApi } from './codegen-openapi.js';
import type { OpenApiConfig, OpenApiSecurityScheme, ContractKitPlugin } from '@maroonedsoftware/contractkit';

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
