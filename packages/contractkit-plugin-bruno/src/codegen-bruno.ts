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
} from '@maroonedsoftware/contractkit';
import { resolveSecurity, SECURITY_NONE } from '@maroonedsoftware/contractkit';
import { basename } from 'path';

export interface OpenCollectionFile {
    relativePath: string;
    content: string;
}

/** Manifest filename — tracks which files this plugin previously generated so subsequent runs can clean up only those, leaving any user-added files alone. */
export const MANIFEST_FILENAME = '.contractkit-bruno-manifest.json';

/** Subset of a security scheme sufficient for Bruno auth generation (non-HMAC). */
export interface BrunoSecurityScheme {
    type: string; // "http" | "apiKey" | "oauth2" | "openIdConnect"
    scheme?: string; // "bearer" | "basic" (when type === "http")
    name?: string; // header/query param name (when type === "apiKey")
    in?: string; // "header" | "query" (when type === "apiKey")
}

export interface BrunoAuthOptions {
    /** Name of the default scheme (from config.security.default) */
    defaultScheme?: string;
    /** Scheme definitions keyed by name (non-HMAC only) */
    schemes?: Record<string, BrunoSecurityScheme>;
}

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
}

/**
 * Generates an OpenCollection (https://spec.opencollection.com/) API collection
 * from a set of operation roots. Produces opencollection.yml, an environment
 * file, and one .yml request file per operation.
 */
export function generateOpenCollection(roots: OpRootNode[], options: OpenCollectionOptions): OpenCollectionFile[] {
    const files: OpenCollectionFile[] = [];

    const modelMap = buildModelMap(options.contractRoots ?? []);
    const authOpts = options.auth;
    const defaultScheme = authOpts?.defaultScheme ? authOpts.schemes?.[authOpts.defaultScheme] : undefined;
    const randomExamples = options.randomExamples ?? false;

    files.push({ relativePath: 'opencollection.yml', content: generateCollectionRoot(options.collectionName, defaultScheme) });
    files.push({ relativePath: 'environments/local.yml', content: generateEnvFile(defaultScheme) });
    // Manifest is appended at the end so it lists every generated path including itself.

    for (let rootIdx = 0; rootIdx < roots.length; rootIdx++) {
        const root = roots[rootIdx]!;
        const folder = root.meta['area'] ? slugifyName(root.meta['area']) : deriveFolderName(root.file);
        const displayName = (root.meta['area'] ?? folder).charAt(0).toUpperCase() + (root.meta['area'] ?? folder).slice(1);

        files.push({ relativePath: `${folder}/folder.yml`, content: generateFolderFile(displayName, rootIdx + 1) });

        const subarea = root.meta['subarea'];
        const subareaSlug = subarea ? slugifyName(subarea) : undefined;
        const requestDir = subareaSlug ? `${folder}/${subareaSlug}` : folder;

        if (subareaSlug) {
            const subareaDisplayName = subarea!.charAt(0).toUpperCase() + subarea!.slice(1);
            files.push({ relativePath: `${requestDir}/folder.yml`, content: generateFolderFile(subareaDisplayName, 1) });
        }

        let seq = 1;
        for (const route of root.routes) {
            for (const op of route.operations) {
                const requestName = op.name ?? route.path;
                const fileName = op.name ? `${slugifyName(op.name)}.yml` : `${op.method}-${sanitizePath(route.path)}.yml`;
                files.push({
                    relativePath: `${requestDir}/${fileName}`,
                    content: generateRequestFile(route, op, requestName, seq, modelMap, root, defaultScheme, randomExamples),
                });
                seq++;
            }
        }
    }

    const trackedPaths = [...files.map(f => f.relativePath), MANIFEST_FILENAME].sort();
    files.push({
        relativePath: MANIFEST_FILENAME,
        content: JSON.stringify({ files: trackedPaths }, null, 2) + '\n',
    });

    return files;
}

/** Parse a previously-written manifest. Returns the list of relative paths to clean up. Returns [] if missing or unreadable so a stale/garbled manifest never blocks regeneration. */
export function parseManifest(content: string): string[] {
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed?.files) && parsed.files.every((f: unknown) => typeof f === 'string')) {
            return parsed.files as string[];
        }
    } catch {
        // fall through
    }
    return [];
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

function generateEnvFile(scheme?: BrunoSecurityScheme): string {
    const lines = [`name: Local`, `variables:`, `  - name: baseUrl`, `    value: "http://localhost:3000"`];
    if (scheme) {
        for (const varName of authEnvVarNames(scheme)) {
            lines.push(`  - name: ${varName}`);
            lines.push(`    value: ""`);
        }
    }
    lines.push(``);
    return lines.join('\n');
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
        const preferredOrder: Array<typeof op.request.bodies[number]['contentType']> = [
            'application/json',
            'application/x-www-form-urlencoded',
            'multipart/form-data',
        ];
        const primary = preferredOrder
            .map(ct => op.request!.bodies.find(b => b.contentType === ct))
            .find(b => b !== undefined) ?? op.request.bodies[0]!;

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

    // runtime.assertions — auto-generate a status-code check from the declared response.
    const expectedStatus = pickAssertionStatus(op.responses);
    if (expectedStatus !== undefined) {
        lines.push(``);
        lines.push(`runtime:`);
        lines.push(`  assertions:`);
        lines.push(`    - expression: res.status`);
        lines.push(`      operator: eq`);
        // Always quote — the OpenCollection schema types `value` as a string,
        // so we must keep "200" from being parsed as YAML number 200.
        lines.push(`      value: "${expectedStatus}"`);
    }

    // docs — combine route- and operation-level descriptions as a markdown block.
    const docs = buildRequestDocs(route, op);
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

/** Build a markdown docs block from route- and operation-level descriptions. */
function buildRequestDocs(route: OpRouteNode, op: OpOperationNode): string | undefined {
    const parts: string[] = [];
    if (route.description) parts.push(route.description.trim());
    if (op.description) parts.push(op.description.trim());
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

/** Resolve all fields for a model, including inherited base fields (base-first). */
function resolveModelFields(model: ModelNode, modelMap: Map<string, ModelNode>): FieldNode[] {
    const baseFields = model.base ? resolveModelFields(modelMap.get(model.base) ?? ({ fields: [] } as unknown as ModelNode), modelMap) : [];
    return [...baseFields, ...model.fields];
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

/** Build an example object from a list of FieldNodes. Excludes readonly; uses defaults when available, null for optional fields without one. */
function fieldsToExampleObject(fields: FieldNode[], modelMap: Map<string, ModelNode>, randomExamples = false): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const field of fields) {
        if (field.visibility === 'readonly') continue;
        if (field.default !== undefined) {
            obj[field.name] = field.default;
        } else if (field.optional) {
            obj[field.name] = null;
        } else {
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
