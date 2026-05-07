import type {
    OpRootNode,
    OpRouteNode,
    OpOperationNode,
    OpResponseNode,
    ParamSource,
    ContractTypeNode,
    ContractRootNode,
    ModelNode,
    FieldNode,
    IncrementalManifest,
    IncrementalUnit,
    IncrementalResult as IncrementalResultBase,
} from '@contractkit/core';
import {
    resolveSecurity,
    resolveModifiers,
    SECURITY_NONE,
    collectTransitiveModelRefs,
    runIncrementalCodegen,
    parseIncrementalManifest,
    emptyIncrementalManifest,
    serializeIncrementalManifest,
    hashFingerprint,
    INCREMENTAL_MANIFEST_VERSION,
} from '@contractkit/core';
import { basename } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** A single file produced by the Bruno codegen — a relative output path and its YAML content. */
export interface OpenCollectionFile {
    relativePath: string;
    content: string;
}

/** Manifest filename — tracks which files this plugin previously generated so subsequent runs can clean up only those, leaving any user-added files alone. */
export const MANIFEST_FILENAME = '.contractkit-bruno-manifest.json';

/**
 * Bumped whenever the codegen output shape changes in a way that should bust
 * every per-op fingerprint. Mixed into the per-op fingerprint so a plugin
 * upgrade forces full regeneration even when source `.ck` files are unchanged.
 */
export const BRUNO_CODEGEN_VERSION = '1';

/** Subset of a security scheme sufficient for Bruno auth generation (non-HMAC). */
export interface BrunoSecurityScheme {
    type: string; // "http" | "apiKey" | "oauth2" | "openIdConnect"
    scheme?: string; // "bearer" | "basic" (when type === "http")
    name?: string; // header/query param name (when type === "apiKey")
    in?: string; // "header" | "query" (when type === "apiKey")
}

/** Auth configuration passed to the Bruno codegen; drives collection-level auth and per-operation auth blocks. */
export interface BrunoAuthOptions {
    /** Name of the default scheme (from config.security.default) */
    defaultScheme?: string;
    /** Scheme definitions keyed by name (non-HMAC only) */
    schemes?: Record<string, BrunoSecurityScheme>;
}

/** Options controlling what {@link generateOpenCollection} emits. */
export interface OpenCollectionOptions {
    collectionName: string;
    contractRoots?: ContractRootNode[];
    auth?: BrunoAuthOptions;
    /**
     * When true, emit Bruno faker template strings (e.g. `{{$randomUUID}}`,
     * `{{$randomEmail}}`) for compatible scalar types so each send produces
     * fresh data. When false (default), use deterministic placeholders.
     */
    randomExamples?: boolean;
    /**
     * Whether to generate request files for operations marked `internal`. Defaults to
     * `true` — Bruno collections are typically used by the team that owns the API and
     * benefit from full coverage. Set to `false` to omit internal ops.
     */
    includeInternal?: boolean;
    /**
     * Map of environment name → variables. Each entry produces a
     * `environments/<name>.yml` file with the variables in declaration order.
     * Values are coerced to strings.
     *
     * When omitted, a default `environments/local.yml` is emitted with
     * `baseUrl=http://localhost:3000` plus any auth env-var placeholders the
     * default scheme requires. When provided, the default is replaced entirely
     * — auth vars are not auto-injected, so include them explicitly if needed.
     */
    environments?: Record<string, Record<string, unknown>>;
}

/** Per-operation bookkeeping computed up front: where the file lives, what to call it, and the YAML inputs needed to render or fingerprint it. */
interface OpEntry {
    /** Stable identifier across runs — `<file>::<METHOD> <path>`. */
    opKey: string;
    /** Output path relative to the collection root (e.g. `users/get-user.yml`). */
    relativePath: string;
    /** Display name used inside the YAML `info:` block (alphabetized within its folder). */
    requestName: string;
    /** 1-based sequence within the request's containing folder, drives Bruno's UI ordering. */
    seq: number;
    route: OpRouteNode;
    op: OpOperationNode;
    root: OpRootNode;
}

/**
 * @deprecated Use {@link IncrementalManifest} from `@contractkit/core`. Re-exported here for backwards compatibility.
 */
export type BrunoManifest = IncrementalManifest;

/** Result of {@link generateOpenCollectionIncremental}. Renamed `skippedOpCount` for Bruno-specific clarity but otherwise the shared {@link IncrementalResultBase}. */
export interface IncrementalResult extends Omit<IncrementalResultBase, 'skippedUnitCount'> {
    /** Number of ops whose codegen was skipped because their fingerprint matched. */
    skippedOpCount: number;
}

/**
 * Generates an OpenCollection (https://spec.opencollection.com/) API collection
 * from a set of operation roots. Produces opencollection.yml, an environment
 * file, one .yml request file per operation, and the tracking manifest.
 *
 * This is the full-regeneration entry point — every file is rebuilt from scratch.
 * For cache-aware incremental builds, use {@link generateOpenCollectionIncremental}.
 *
 * The manifest appears in the returned list (under {@link MANIFEST_FILENAME}) for
 * convenience — single-shot callers can write the entire array as-is. The plugin's
 * incremental path persists the manifest separately (under the CLI cache dir), so
 * its `filesToWrite` does not include the manifest.
 */
export function generateOpenCollection(roots: OpRootNode[], options: OpenCollectionOptions): OpenCollectionFile[] {
    const result = generateOpenCollectionIncremental(roots, options, emptyManifest());
    return [...result.filesToWrite, { relativePath: MANIFEST_FILENAME, content: serializeIncrementalManifest(result.manifest) }];
}

/**
 * Cache-aware variant of {@link generateOpenCollection}. Skips re-rendering YAML
 * for any op whose fingerprint matches the entry in `prevManifest`. The caller is
 * responsible for emitting `filesToWrite`, deleting `deletedPaths`, and persisting
 * `manifest` so the next run can match against it.
 *
 * Global files (collection root, env files, folder.yml) are always regenerated —
 * they're cheap and depend on options the manifest doesn't fingerprint.
 */
export function generateOpenCollectionIncremental(
    roots: OpRootNode[],
    options: OpenCollectionOptions,
    prevManifest: IncrementalManifest,
    fileExists: (relativePath: string) => boolean = () => true,
): IncrementalResult {
    const modelMap = buildModelMap(options.contractRoots ?? []);
    const authOpts = options.auth;
    const defaultScheme = authOpts?.defaultScheme ? authOpts.schemes?.[authOpts.defaultScheme] : undefined;
    const randomExamples = options.randomExamples ?? false;
    const includeInternal = options.includeInternal ?? true;

    // ── Global files (collection root + env files + folder.yml per area/subarea) ──
    const globalFiles: OpenCollectionFile[] = [];
    globalFiles.push({
        relativePath: 'opencollection.yml',
        content: generateCollectionRoot(options.collectionName, defaultScheme),
    });
    for (const envFile of generateEnvFiles(options.environments, defaultScheme)) {
        globalFiles.push(envFile);
    }

    const sortedRoots = [...roots].sort((a, b) => {
        const aArea = a.meta['area'] ?? deriveFolderName(a.file);
        const bArea = b.meta['area'] ?? deriveFolderName(b.file);
        const cmp = aArea.localeCompare(bArea);
        if (cmp !== 0) return cmp;
        return (a.meta['subarea'] ?? '').localeCompare(b.meta['subarea'] ?? '');
    });

    const units: IncrementalUnit[] = [];
    for (let rootIdx = 0; rootIdx < sortedRoots.length; rootIdx++) {
        const root = sortedRoots[rootIdx]!;
        const folder = root.meta['area'] ? slugifyName(root.meta['area']) : deriveFolderName(root.file);
        const displayName = (root.meta['area'] ?? folder).charAt(0).toUpperCase() + (root.meta['area'] ?? folder).slice(1);
        globalFiles.push({ relativePath: `${folder}/folder.yml`, content: generateFolderFile(displayName, rootIdx + 1) });

        const subarea = root.meta['subarea'];
        const subareaSlug = subarea ? slugifyName(subarea) : undefined;
        const requestDir = subareaSlug ? `${folder}/${subareaSlug}` : folder;

        if (subareaSlug) {
            const subareaDisplayName = subarea!.charAt(0).toUpperCase() + subarea!.slice(1);
            globalFiles.push({ relativePath: `${requestDir}/folder.yml`, content: generateFolderFile(subareaDisplayName, 1) });
        }

        for (const entry of buildOpEntries(root, requestDir, includeInternal)) {
            units.push({
                key: entry.opKey,
                fingerprint: computeOpFingerprint(entry, modelMap, defaultScheme, randomExamples),
                render: () => [renderOpFile(entry, modelMap, defaultScheme, randomExamples)],
            });
        }
    }

    const result = runIncrementalCodegen({
        codegenVersion: BRUNO_CODEGEN_VERSION,
        prevManifest,
        globalFiles,
        units,
        fileExists,
    });

    return {
        filesToWrite: result.filesToWrite,
        manifest: result.manifest,
        deletedPaths: result.deletedPaths,
        skippedOpCount: result.skippedUnitCount,
    };
}

/** Build the ordered, alphabetized op entries for a single root. seq numbers are assigned in alphabetical order so the Bruno UI shows requests sorted by display name. */
function buildOpEntries(root: OpRootNode, requestDir: string, includeInternal: boolean): OpEntry[] {
    const requests: Array<{ route: OpRouteNode; op: OpOperationNode; requestName: string }> = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            requests.push({ route, op, requestName: op.name ?? route.path });
        }
    }
    requests.sort((a, b) => a.requestName.localeCompare(b.requestName));

    const entries: OpEntry[] = [];
    let seq = 1;
    for (const { route, op, requestName } of requests) {
        const fileName = op.name ? `${slugifyName(op.name)}.yml` : `${op.method}-${sanitizePath(route.path)}.yml`;
        entries.push({
            opKey: `${root.file}::${op.method.toUpperCase()} ${route.path}`,
            relativePath: `${requestDir}/${fileName}`,
            requestName,
            seq,
            route,
            op,
            root,
        });
        seq++;
    }
    return entries;
}

/** Render a single op's request file (including any plugin-extension YAML override). */
function renderOpFile(
    entry: OpEntry,
    modelMap: Map<string, ModelNode>,
    defaultScheme: BrunoSecurityScheme | undefined,
    randomExamples: boolean,
): OpenCollectionFile {
    let content = generateRequestFile(entry.route, entry.op, entry.requestName, entry.seq, modelMap, entry.root, defaultScheme, randomExamples);
    const brunoExt = entry.op.pluginExtensions?.['bruno'];
    const pluginOverride = brunoExt && typeof brunoExt === 'object' && !Array.isArray(brunoExt) ? brunoExt['template'] : undefined;
    if (typeof pluginOverride === 'string') {
        content = mergePluginFile(content, pluginOverride);
    }
    return { relativePath: entry.relativePath, content };
}

/** Compute a fingerprint covering every input that affects this op's rendered file. Stable across runs given identical inputs. */
function computeOpFingerprint(
    entry: OpEntry,
    modelMap: Map<string, ModelNode>,
    defaultScheme: BrunoSecurityScheme | undefined,
    randomExamples: boolean,
): string {
    const referencedModels = collectTransitiveModelRefs(collectOpTypeNodes(entry.route, entry.op), modelMap);
    const modelSnapshot: Record<string, unknown> = {};
    for (const name of [...referencedModels].sort()) {
        const m = modelMap.get(name);
        if (m) modelSnapshot[name] = m;
    }
    // Only include the route fields this op actually depends on. We deliberately exclude
    // `route.operations` so a change to a sibling op doesn't invalidate this op's cache.
    const routeShape = {
        path: entry.route.path,
        params: entry.route.params ?? null,
        modifiers: entry.route.modifiers ?? null,
        security: entry.route.security ?? null,
        description: entry.route.description ?? null,
    };
    return hashFingerprint({
        v: BRUNO_CODEGEN_VERSION,
        opKey: entry.opKey,
        relativePath: entry.relativePath,
        requestName: entry.requestName,
        seq: entry.seq,
        route: routeShape,
        op: entry.op,
        rootMeta: entry.root.meta,
        rootFile: entry.root.file,
        defaultScheme: defaultScheme ?? null,
        randomExamples,
        models: modelSnapshot,
    });
}

/** Collect every ContractTypeNode that contributes to this op's rendered output. Used as the seed set for transitive model collection in {@link computeOpFingerprint}. */
function collectOpTypeNodes(route: OpRouteNode, op: OpOperationNode): ContractTypeNode[] {
    const out: ContractTypeNode[] = [];
    pushFromParamSource(route.params, out);
    pushFromParamSource(op.query, out);
    pushFromParamSource(op.headers, out);
    if (op.request) {
        for (const body of op.request.bodies) out.push(body.bodyType);
    }
    for (const resp of op.responses) {
        if (resp.bodyType) out.push(resp.bodyType);
        if (resp.headers) {
            for (const h of resp.headers) out.push(h.type);
        }
    }
    return out;
}

function pushFromParamSource(src: ParamSource | undefined, out: ContractTypeNode[]): void {
    if (!src) return;
    if (src.kind === 'params') {
        for (const n of src.nodes) out.push(n.type);
    } else if (src.kind === 'ref') {
        out.push({ kind: 'ref', name: src.name } as ContractTypeNode);
    } else if (src.kind === 'type') {
        out.push(src.node);
    }
}

/** Empty-state manifest, used when none has been written yet (or when the cache is being bypassed). */
export function emptyManifest(): IncrementalManifest {
    return emptyIncrementalManifest(BRUNO_CODEGEN_VERSION);
}

/**
 * Parse a previously-written manifest. Accepts both v1 (`{ files: string[] }`) and v2
 * (full {@link IncrementalManifest}) shapes. v1 manifests are returned with an empty
 * `units` map so the next run treats every op as a cache miss while still cleaning up
 * the tracked file list.
 *
 * Returns an empty manifest on any parse error so a stale/garbled file never blocks
 * regeneration.
 */
export function parseManifest(content: string): IncrementalManifest {
    const parsed = parseIncrementalManifest(content);
    // The shared parser handles v2. If v2 parsing produced an empty manifest, fall
    // through to a v1 shape ({ files: [...] }) and migrate it for cleanup purposes.
    if (parsed.files.length > 0 || Object.keys(parsed.units).length > 0) return parsed;
    try {
        const raw = JSON.parse(content);
        if (Array.isArray(raw?.files) && raw.files.every((f: unknown) => typeof f === 'string')) {
            return {
                version: INCREMENTAL_MANIFEST_VERSION,
                codegenVersion: '',
                files: raw.files as string[],
                units: {},
            };
        }
    } catch {
        // fall through
    }
    return emptyManifest();
}

// ─── Plugin file merge ─────────────────────────────────────────────────────

function deepMerge(base: unknown, override: unknown): unknown {
    if (
        override !== null &&
        typeof override === 'object' &&
        !Array.isArray(override) &&
        base !== null &&
        typeof base === 'object' &&
        !Array.isArray(base)
    ) {
        const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
        for (const [key, val] of Object.entries(override as Record<string, unknown>)) {
            result[key] = deepMerge(result[key], val);
        }
        return result;
    }
    return override;
}

/**
 * Deep-merges a YAML override string into a generated YAML string.
 *
 * Objects are merged recursively; arrays and scalars in the override replace the
 * generated value entirely. If `pluginFileContent` is not a YAML mapping (e.g. it
 * is a scalar or a list), the generated content is returned unchanged.
 *
 * @param generatedYaml - The YAML string produced by the Bruno codegen.
 * @param pluginFileContent - The YAML override string to merge in.
 * @returns The merged YAML string, or `generatedYaml` if the override is not a mapping.
 */
export function mergePluginFile(generatedYaml: string, pluginFileContent: string): string {
    const overrideParsed = parseYaml(pluginFileContent);
    if (overrideParsed === null || typeof overrideParsed !== 'object' || Array.isArray(overrideParsed)) {
        return generatedYaml;
    }
    const merged = deepMerge(parseYaml(generatedYaml), overrideParsed);
    return stringifyYaml(merged, { lineWidth: 0 });
}

// ─── File generators ───────────────────────────────────────────────────────

function generateCollectionRoot(name: string, scheme?: BrunoSecurityScheme): string {
    const lines = [`opencollection: "1.0.0"`, `info:`, `  name: ${yamlString(name)}`];
    if (scheme) {
        lines.push(``);
        lines.push(`request:`);
        lines.push(...renderAuthBlock(scheme, '  '));
    }
    lines.push(``);
    return lines.join('\n');
}

function generateEnvFiles(
    environments: Record<string, Record<string, unknown>> | undefined,
    scheme: BrunoSecurityScheme | undefined,
): OpenCollectionFile[] {
    if (environments && Object.keys(environments).length > 0) {
        return Object.entries(environments).map(([name, variables]) => ({
            relativePath: `environments/${name}.yml`,
            content: renderEnvFile(displayNameFor(name), variables),
        }));
    }
    const defaultVars: Record<string, string> = { baseUrl: 'http://localhost:3000' };
    if (scheme) {
        for (const varName of authEnvVarNames(scheme)) defaultVars[varName] = '';
    }
    return [{ relativePath: 'environments/local.yml', content: renderEnvFile('Local', defaultVars) }];
}

function renderEnvFile(name: string, variables: Record<string, unknown>): string {
    const lines = [`name: ${name}`, `variables:`];
    for (const [key, value] of Object.entries(variables)) {
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines.push(`  - name: ${key}`);
        lines.push(`    value: "${escaped}"`);
    }
    lines.push(``);
    return lines.join('\n');
}

function displayNameFor(envKey: string): string {
    return envKey.charAt(0).toUpperCase() + envKey.slice(1);
}

function generateFolderFile(name: string, seq: number): string {
    return [`info:`, `  name: ${yamlString(name)}`, `  type: folder`, `  seq: ${seq}`, ``].join('\n');
}

function generateRequestFile(
    route: OpRouteNode,
    op: OpOperationNode,
    name: string,
    seq: number,
    modelMap: Map<string, ModelNode>,
    root?: OpRootNode,
    defaultScheme?: BrunoSecurityScheme,
    randomExamples = false,
): string {
    const lines: string[] = [];

    lines.push(`info:`);
    lines.push(`  name: ${yamlString(name)}`);
    lines.push(`  type: http`);
    lines.push(`  seq: ${seq}`);
    lines.push(``);
    lines.push(`http:`);
    lines.push(`  method: ${op.method.toUpperCase()}`);
    lines.push(`  url: ${yamlString(`{{baseUrl}}${openCollectionPath(route.path)}`)}`);

    // Params — flat array with type: "path" | "query". Optional query params are
    // emitted with disabled: true so users opt in before sending.
    const pathParams: Array<ParamEntry & { kind: 'path' | 'query' }> = extractPathParamNames(route.path).map(n => ({
        name: n,
        type: findParamType(route.params, n, modelMap),
        optional: false,
        kind: 'path' as const,
    }));
    const queryParams: Array<ParamEntry & { kind: 'path' | 'query' }> = op.query
        ? expandParamSource(op.query, modelMap).map(e => ({ ...e, kind: 'query' as const }))
        : [];
    const allParams = [...pathParams, ...queryParams];

    if (allParams.length > 0) {
        lines.push(`  params:`);
        for (const p of allParams) {
            lines.push(`    - name: ${p.name}`);
            lines.push(`      value: ${paramExampleValue(p.type, p.default, randomExamples)}`);
            lines.push(`      type: ${p.kind}`);
            if (p.optional && p.kind === 'query') lines.push(`      disabled: true`);
        }
    }

    // Headers
    if (op.headers) {
        const headerEntries = expandParamSource(op.headers, modelMap);
        if (headerEntries.length > 0) {
            lines.push(`  headers:`);
            for (const h of headerEntries) {
                lines.push(`    - name: ${h.name}`);
                lines.push(`      value: ${paramExampleValue(h.type, h.default, randomExamples)}`);
                if (h.optional) lines.push(`      disabled: true`);
            }
        }
    }

    // Auth — inside http block; inherit collection default unless this op is explicitly public
    if (defaultScheme) {
        const security = root ? resolveSecurity(route, op, root) : (op.security ?? route.security);
        if (security === SECURITY_NONE) {
            lines.push(`  auth:`);
            lines.push(`    type: none`);
        } else {
            lines.push(`  auth: inherit`);
        }
    }

    // Body — Bruno supports a single body per request, so prefer JSON, then form-urlencoded, then multipart.
    if (op.request && op.request.bodies.length > 0) {
        const preferredOrder: Array<(typeof op.request.bodies)[number]['contentType']> = [
            'application/json',
            'application/x-www-form-urlencoded',
            'multipart/form-data',
        ];
        const primary =
            preferredOrder.map(ct => op.request!.bodies.find(b => b.contentType === ct)).find(b => b !== undefined) ?? op.request.bodies[0]!;

        lines.push(`  body:`);
        if (primary.contentType === 'multipart/form-data') {
            lines.push(`    type: multipart-form`);
            lines.push(`    data: []`);
        } else if (primary.contentType === 'application/x-www-form-urlencoded') {
            lines.push(`    type: form-urlencoded`);
            lines.push(`    data: []`);
        } else {
            const json = JSON.stringify(typeToExampleValue(primary.bodyType, modelMap, randomExamples), null, 2);
            lines.push(`    type: json`);
            lines.push(`    data: |`);
            for (const jsonLine of json.split('\n')) {
                lines.push(`      ${jsonLine}`);
            }
        }
    }

    // runtime.assertions — auto-generate a status-code check and presence checks for required response headers.
    const expectedStatus = pickAssertionStatus(op.responses);
    const assertedResponse = op.responses.find(r => r.statusCode === expectedStatus);
    const requiredHeaders = (assertedResponse?.headers ?? []).filter(h => !h.optional);
    if (expectedStatus !== undefined) {
        lines.push(``);
        lines.push(`runtime:`);
        lines.push(`  assertions:`);
        lines.push(`    - expression: res.status`);
        lines.push(`      operator: eq`);
        // Always quote — the OpenCollection schema types `value` as a string,
        // so we must keep "200" from being parsed as YAML number 200.
        lines.push(`      value: "${expectedStatus}"`);
        for (const h of requiredHeaders) {
            lines.push(`    - expression: res.headers["${h.name.toLowerCase()}"]`);
            lines.push(`      operator: isDefined`);
            lines.push(`      value: ""`);
        }
    }

    // docs — combine route- and operation-level descriptions plus the declared response-header summary.
    const docs = buildRequestDocs(route, op, assertedResponse);
    if (docs) {
        lines.push(``);
        lines.push(`docs: |-`);
        for (const docLine of docs.split('\n')) {
            lines.push(`  ${docLine}`);
        }
    }

    lines.push(``);
    return lines.join('\n');
}

/** Pick the response whose status code we'll assert against. Prefers the first declared 2xx; otherwise falls back to the first declared response. Returns undefined if no responses are declared. */
function pickAssertionStatus(responses: OpResponseNode[]): number | undefined {
    const success = responses.find(r => r.statusCode >= 200 && r.statusCode < 300);
    return success?.statusCode ?? responses[0]?.statusCode;
}

/** Build a markdown docs block from route- and operation-level descriptions, plus declared response-header summary. */
function buildRequestDocs(route: OpRouteNode, op: OpOperationNode, assertedResponse?: OpResponseNode): string | undefined {
    const parts: string[] = [];
    if (route.description) parts.push(route.description.trim());
    if (op.description) parts.push(op.description.trim());
    const headers = assertedResponse?.headers ?? [];
    if (headers.length > 0) {
        const lines = ['**Response headers**', ''];
        for (const h of headers) {
            const tag = h.optional ? 'optional' : 'required';
            const desc = h.description ? ` — ${h.description}` : '';
            lines.push(`- \`${h.name}\` (${tag})${desc}`);
        }
        parts.push(lines.join('\n'));
    }
    return parts.length > 0 ? parts.join('\n\n') : undefined;
}

// ─── Auth helpers ──────────────────────────────────────────────────────────

/** Generate the YAML lines for an auth block (flat, per spec), indented by `indent`. */
function renderAuthBlock(scheme: BrunoSecurityScheme, indent: string): string[] {
    const i = indent;
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        return [`${i}auth:`, `${i}  type: bearer`, `${i}  token: "{{token}}"`];
    }
    if (scheme.type === 'http' && scheme.scheme === 'basic') {
        return [`${i}auth:`, `${i}  type: basic`, `${i}  username: "{{username}}"`, `${i}  password: "{{password}}"`];
    }
    if (scheme.type === 'apiKey' && scheme.in === 'header') {
        const headerName = scheme.name ?? 'X-Api-Key';
        return [`${i}auth:`, `${i}  type: apikey`, `${i}  key: ${headerName}`, `${i}  value: "{{apiKey}}"`, `${i}  placement: header`];
    }
    return [];
}

/** Return the environment variable names needed for a given auth scheme. */
function authEnvVarNames(scheme: BrunoSecurityScheme): string[] {
    if (scheme.type === 'http' && scheme.scheme === 'bearer') return ['token'];
    if (scheme.type === 'http' && scheme.scheme === 'basic') return ['username', 'password'];
    if (scheme.type === 'apiKey') return ['apiKey'];
    return [];
}

// ─── Model registry ────────────────────────────────────────────────────────

function buildModelMap(contractRoots: ContractRootNode[]): Map<string, ModelNode> {
    const map = new Map<string, ModelNode>();
    for (const root of contractRoots) {
        for (const model of root.models) {
            map.set(model.name, model);
        }
    }
    return map;
}

/** Resolve all fields for a model, including inherited base fields (bases first, in declaration order). */
function resolveModelFields(model: ModelNode, modelMap: Map<string, ModelNode>): FieldNode[] {
    const collected: FieldNode[] = [];
    if (model.bases) {
        for (const base of model.bases) {
            const baseModel = modelMap.get(base);
            if (baseModel) collected.push(...resolveModelFields(baseModel, modelMap));
        }
    }
    return [...collected, ...model.fields];
}

// ─── Param helpers ─────────────────────────────────────────────────────────

interface ParamEntry {
    name: string;
    type: ContractTypeNode | undefined;
    default?: string | number | boolean;
    optional: boolean;
}

/** Expand a ParamSource into a flat list of named entries with their types. */
function expandParamSource(source: ParamSource, modelMap: Map<string, ModelNode>): ParamEntry[] {
    if (source.kind === 'params') {
        return source.nodes.map(n => ({ name: n.name, type: n.type, default: n.default, optional: n.optional }));
    }
    if (source.kind === 'ref') {
        const model = modelMap.get(source.name);
        if (model) {
            return resolveModelFields(model, modelMap)
                .filter(f => f.visibility !== 'readonly')
                .map(f => ({ name: f.name, type: f.type, default: f.default, optional: f.optional }));
        }
        // Fallback: single placeholder entry
        const name = source.name.charAt(0).toLowerCase() + source.name.slice(1);
        return [{ name, type: undefined, optional: false }];
    }
    // kind === 'type': if it's an inline object, expand its fields
    if (source.node.kind === 'inlineObject') {
        return source.node.fields.map(f => ({ name: f.name, type: f.type, default: f.default, optional: f.optional }));
    }
    return [];
}

/** Look up a named path param's type from route.params. */
function findParamType(source: ParamSource | undefined, name: string, modelMap: Map<string, ModelNode>): ContractTypeNode | undefined {
    if (!source) return undefined;
    if (source.kind === 'params') return source.nodes.find(n => n.name === name)?.type;
    if (source.kind === 'ref') {
        const model = modelMap.get(source.name);
        if (model) return resolveModelFields(model, modelMap).find(f => f.name === name)?.type;
    }
    if (source.kind === 'type' && source.node.kind === 'inlineObject') {
        return source.node.fields.find(f => f.name === name)?.type;
    }
    return undefined;
}

/** Return a YAML-quoted example value string for a param, preferring a default value when provided. */
function paramExampleValue(type: ContractTypeNode | undefined, defaultValue?: string | number | boolean, randomExamples = false): string {
    if (defaultValue !== undefined) return `"${defaultValue}"`;
    if (!type) return '""';
    if (type.kind === 'enum') return type.values.length > 0 ? `"${type.values[0]}"` : '""';
    if (type.kind === 'literal') return `"${type.value}"`;
    if (type.kind !== 'scalar') return '""';
    if (randomExamples) {
        const random = randomScalarTemplate(type.name);
        if (random !== undefined) return `"${random}"`;
    }
    switch (type.name) {
        case 'uuid':
            return '"00000000-0000-0000-0000-000000000000"';
        case 'email':
            return '"user@example.com"';
        case 'url':
            return '"https://example.com"';
        case 'number':
        case 'int':
        case 'bigint':
            return '"0"';
        case 'boolean':
            return '"true"';
        case 'date':
            return '"2024-01-01"';
        case 'time':
            return '"00:00:00"';
        case 'datetime':
            return '"2024-01-01T00:00:00Z"';
        case 'duration':
            return '"PT1H"';
        default:
            return '""';
    }
}

/** Bruno faker template for a scalar type, or undefined when no clean equivalent exists (date, time, duration, raw string). */
function randomScalarTemplate(name: string): string | undefined {
    switch (name) {
        case 'uuid':
            return '{{$randomUUID}}';
        case 'email':
            return '{{$randomEmail}}';
        case 'url':
            return '{{$randomUrl}}';
        case 'number':
        case 'int':
        case 'bigint':
            return '{{$randomInt}}';
        case 'boolean':
            return '{{$randomBoolean}}';
        case 'datetime':
            return '{{$isoTimestamp}}';
        default:
            return undefined;
    }
}

// ─── Body helpers ──────────────────────────────────────────────────────────

/**
 * Recursively build an example JSON value from a ContractTypeNode.
 *
 * When `randomExamples` is true we substitute Bruno faker templates only for
 * scalars whose JSON representation is a string (uuid/email/url/datetime).
 * Numbers and booleans stay deterministic — embedding `{{$randomInt}}` as a
 * bare JSON number would require sentinel-stripping the surrounding quotes,
 * and the body skeleton is meant as a starting point users edit anyway.
 */
function typeToExampleValue(type: ContractTypeNode, modelMap: Map<string, ModelNode>, randomExamples = false): unknown {
    switch (type.kind) {
        case 'scalar':
            switch (type.name) {
                case 'string':
                    return '';
                case 'email':
                    return randomExamples ? '{{$randomEmail}}' : 'user@example.com';
                case 'url':
                    return randomExamples ? '{{$randomUrl}}' : 'https://example.com';
                case 'uuid':
                    return randomExamples ? '{{$randomUUID}}' : '00000000-0000-0000-0000-000000000000';
                case 'number':
                case 'int':
                case 'bigint':
                    return 0;
                case 'boolean':
                    return true;
                case 'date':
                    return '2024-01-01';
                case 'time':
                    return '00:00:00';
                case 'datetime':
                    return randomExamples ? '{{$isoTimestamp}}' : '2024-01-01T00:00:00Z';
                case 'duration':
                    return 'PT1H';
                case 'null':
                    return null;
                default:
                    return null;
            }
        case 'enum':
            return type.values[0] ?? '';
        case 'literal':
            return type.value;
        case 'array':
            return [typeToExampleValue(type.item, modelMap, randomExamples)];
        case 'tuple':
            return type.items.map(t => typeToExampleValue(t, modelMap, randomExamples));
        case 'record':
            return {};
        case 'union':
            return type.members.length > 0 ? typeToExampleValue(type.members[0]!, modelMap, randomExamples) : null;
        case 'discriminatedUnion':
            return type.members.length > 0 ? typeToExampleValue(type.members[0]!, modelMap, randomExamples) : null;
        case 'intersection':
            return {};
        case 'ref': {
            const model = modelMap.get(type.name);
            if (!model) return {};
            // Type alias — recurse into the aliased type
            if (model.type) return typeToExampleValue(model.type, modelMap, randomExamples);
            return modelToExampleObject(model, modelMap, randomExamples);
        }
        case 'lazy':
            return typeToExampleValue(type.inner, modelMap, randomExamples);
        case 'inlineObject':
            return fieldsToExampleObject(type.fields, modelMap, randomExamples);
        default:
            return null;
    }
}

/** Build an example object from a ModelNode's fields (including inherited base fields). */
function modelToExampleObject(model: ModelNode, modelMap: Map<string, ModelNode>, randomExamples = false): Record<string, unknown> {
    return fieldsToExampleObject(resolveModelFields(model, modelMap), modelMap, randomExamples);
}

/** Build an example object from a list of FieldNodes. Excludes readonly fields; uses defaults when available; omits optional fields that have no default so they don't appear in the JSON output. */
function fieldsToExampleObject(fields: FieldNode[], modelMap: Map<string, ModelNode>, randomExamples = false): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const field of fields) {
        if (field.visibility === 'readonly') continue;
        if (field.default !== undefined) {
            obj[field.name] = field.default;
        } else if (!field.optional) {
            obj[field.name] = typeToExampleValue(field.type, modelMap, randomExamples);
        }
    }
    return obj;
}

// ─── Path helpers ──────────────────────────────────────────────────────────

/** Convert /users/{id}/posts → /users/:id/posts (Bruno path parameter syntax) */
function openCollectionPath(path: string): string {
    return path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ':$1');
}

/** Convert "Create an Offer" → create-an-offer (for .yml file names) */
export function slugifyName(name: string): string {
    const result = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return result || 'request';
}

/** Convert /users/{id}/posts → users-id-posts (for .yml file names) */
export function sanitizePath(path: string): string {
    const result = path
        .replace(/^\//, '')
        .replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, '$1')
        .replace(/\//g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return result || 'root';
}

/** Extract param names from a URL template, e.g. /users/{id} → ['id'] */
function extractPathParamNames(path: string): string[] {
    return [...path.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(m => m[1]!);
}

/** Derive folder name from op file path, e.g. src/users.op → users */
function deriveFolderName(file: string): string {
    return basename(file).replace(/\.(op|ck)$/, '');
}

/**
 * Wrap a string in YAML double quotes if it contains characters that require quoting
 * (flow indicators, colons, braces, etc.).
 */
function yamlString(value: string): string {
    if (/[:{}[\],&*#?|<>=!%@`"']/.test(value) || /^\s|\s$/.test(value)) {
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
}
