import type { HttpMethod, ModelNode, OpOperationNode, ParamSource, RouteModifier, SecurityNode } from '@contractkit/core';

/** Threaded through type/field renderers so a `ref` can lazily expand into the model's fields inline. */
export interface RenderContext {
    /** Lookup table of model name → resolved model entry (carries `filePath` so refs can jump to source). */
    models?: Map<string, ResolvedModel>;
    /** Names already being expanded on this branch — prevents infinite recursion on self-referential models. */
    visited?: ReadonlySet<string>;
    /** Cap on how deep nested model expansions render. Past this depth, refs collapse to plain links. */
    maxDepth?: number;
    /** Current depth — incremented by the renderer on each `ref` descent. Callers should leave this at 0. */
    depth?: number;
}

/** A single API server entry surfaced in the overview. */
export interface PreviewServer {
    url: string;
    description?: string;
}

/** Top-level API metadata rendered in the overview section. */
export interface PreviewConfigMeta {
    title: string;
    version: string;
    description?: string;
    servers?: PreviewServer[];
}

/** A non-fatal diagnostic captured while building {@link PreviewData}. */
export interface PreviewWarning {
    message: string;
    file?: string;
    line?: number;
}

/** An operation with all cascade-resolved data the renderer needs to draw a card. */
export interface ResolvedOperation {
    /** Absolute path of the source .ck file. */
    filePath: string;
    /** Sidebar grouping key — `ast.meta.area`, falling back to the file's relative path. */
    fileGroup: string;
    /** Path template (e.g. `/payments/{id}`). */
    routePath: string;
    method: HttpMethod;
    /** Full operation node — carries `loc`, request/responses, plugins, etc. */
    op: OpOperationNode;
    /** Route-level params (path params) carried alongside the operation for rendering. */
    routeParams?: ParamSource;
    /** `resolveModifiers(route, op)` output — already excludes the synthetic `public` token. */
    effectiveModifiers: RouteModifier[];
    /** `resolveSecurity(route, op, root)` output. */
    effectiveSecurity?: SecurityNode;
}

/** A model paired with the absolute path of the `.ck` file that declared it. */
export interface ResolvedModel {
    filePath: string;
    model: ModelNode;
}

/**
 * Snapshot of an entire workspace's contracts and operations, pre-resolved so the renderer
 * doesn't need to call into `@contractkit/core` at render time.
 */
export interface PreviewData {
    configMeta: PreviewConfigMeta;
    workspaceRoot?: string;
    operations: ResolvedOperation[];
    models: ResolvedModel[];
    warnings: PreviewWarning[];
}
