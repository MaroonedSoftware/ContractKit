import type { ContractKitPlugin, PluginContext } from '@contractkit/core';
import type { OpenApiPluginOptions } from '@contractkit/plugin-openapi';

/** Documentation platforms this plugin can emit for. */
export type DocsTargetName = 'mintlify';

/** Config accepted under `"@contractkit/plugin-docs"` in `contractkit.config.json`. */
export interface DocsPluginConfig {
    /**
     * Documentation platform to emit for. Defaults to `mintlify`, the only target implemented
     * today. An unrecognized value fails the build rather than emitting nothing.
     */
    target?: DocsTargetName;
    /** Docs root, relative to `rootDir`. Default: `docs`. */
    baseDir?: string;
    /** Directory under `baseDir` holding endpoint pages. Default: `api-reference`. */
    apiDir?: string;
    /** Directory under `baseDir` holding model pages. Default: `<apiDir>/models`. */
    modelsDir?: string;
    /**
     * OpenAPI spec settings. Takes the same `output`, `info`, `servers`, `security` and
     * `securitySchemes` options as `@contractkit/plugin-openapi`; the spec is emitted inside
     * `baseDir` and referenced by every generated page. Default output: `openapi.yaml`.
     */
    openapi?: OpenApiPluginOptions;
    /**
     * Title of the generated navigation tab. `false` puts the generated groups directly under
     * `navigation.groups` instead, for a docs site with no tab bar. Default: `API Reference`.
     */
    tab?: string | false;
    /** Emit a page per documented model. Default: `true`. */
    modelPages?: boolean;
    /** Document operations marked `internal`. Default: `false`. */
    includeInternal?: boolean;
    /**
     * Merged over the generated site config (`name`, `theme`, `colors`, `logo`, `favicon`, extra
     * navigation tabs or groups, global anchors, …). Shape is target-specific.
     */
    docs?: Record<string, unknown>;
}

/** The inputs `generateTargets` hands a plugin. */
export type GenerateInputs = Parameters<NonNullable<ContractKitPlugin['generateTargets']>>[0];

/** One documentation platform's generator. */
export interface DocsTarget {
    name: DocsTargetName;
    generate(inputs: GenerateInputs, ctx: PluginContext, config: DocsPluginConfig, rootDir: string): void;
}
