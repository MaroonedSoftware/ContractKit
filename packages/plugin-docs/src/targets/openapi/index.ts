import { resolve } from 'node:path';
import { buildOpenApiDocument, toYaml } from './codegen.js';
import type { DocsTarget, GenerateInputs, OpenApiTargetConfig } from '../../target.js';
import type { PluginContext } from '@contractkit/core';

/**
 * The OpenAPI target.
 *
 * Emits one OpenAPI 3.1 YAML document. This is the interchange artifact rather than a
 * documentation site: gateways, contract tests and client generators consume it, which is why it
 * stays a target you can turn on alone rather than a by-product of the Mintlify one.
 */

/** Resolved output location for the spec. */
export interface OpenApiLayout {
    /** Absolute path the spec is written to. */
    outPath: string;
    /** Absolute directory the spec sits in. */
    baseDir: string;
}

export function resolveLayout(config: OpenApiTargetConfig, rootDir: string): OpenApiLayout {
    const baseDir = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
    return { baseDir, outPath: resolve(baseDir, config.output ?? 'openapi.yaml') };
}

/** Build the document this target would emit, without writing it. */
export function buildSpec(inputs: GenerateInputs, config: OpenApiTargetConfig): Record<string, unknown> {
    const { securitySchemes, ...openapiConfig } = config;
    return buildOpenApiDocument({
        contractRoots: inputs.contractRoots,
        opRoots: inputs.opRoots,
        config: openapiConfig,
        securitySchemes,
    });
}

const target: DocsTarget<OpenApiTargetConfig> = {
    name: 'openapi',
    async generate(inputs: GenerateInputs, ctx: PluginContext, config: OpenApiTargetConfig, rootDir: string): Promise<void> {
        ctx.emitFile(resolveLayout(config, rootDir).outPath, toYaml(buildSpec(inputs, config)));
    },
};

export default target;
