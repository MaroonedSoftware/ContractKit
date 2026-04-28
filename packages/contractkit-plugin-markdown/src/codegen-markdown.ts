import type {
    ContractRootNode,
    OpRootNode,
    OpRouteNode,
    OpOperationNode,
    ContractTypeNode,
    FieldNode,
    ModelNode,
    ParamSource,
    HttpMethod,
} from '@maroonedsoftware/contractkit';
import { resolveModifiers, resolveSecurity, SECURITY_NONE, collectPublicTypeNames, collectTypeRefs } from '@maroonedsoftware/contractkit';

// ─── Local TypeScript type rendering ─────────────────────────────────────

function renderTsType(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return renderTsScalar(type.name);
        case 'array': {
            const inner = renderTsType(type.item);
            const needsParens =
                type.item.kind === 'union' || type.item.kind === 'discriminatedUnion' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'tuple':
            return `[${type.items.map(renderTsType).join(', ')}]`;
        case 'record':
            return `Record<${renderTsType(type.key)}, ${renderTsType(type.value)}>`;
        case 'enum':
            return type.values.map(v => `'${v}'`).join(' | ');
        case 'literal':
            return typeof type.value === 'string' ? `'${type.value}'` : String(type.value);
        case 'union':
            return type.members.map(renderTsType).join(' | ');
        case 'discriminatedUnion':
            return type.members.map(renderTsType).join(' | ');
        case 'intersection':
            return type.members.map(renderTsType).join(' & ');
        case 'ref':
            return type.name;
        case 'lazy':
            return renderTsType(type.inner);
        case 'inlineObject':
            return renderTsInlineObject(type.fields);
        default:
            return 'unknown';
    }
}

function renderTsScalar(name: string): string {
    switch (name) {
        case 'string':
        case 'email':
        case 'url':
        case 'uuid':
            return 'string';
        case 'number':
        case 'int':
            return 'number';
        case 'bigint':
            return 'bigint';
        case 'boolean':
            return 'boolean';
        case 'date':
        case 'datetime':
        case 'duration':
            return 'string';
        case 'null':
            return 'null';
        case 'unknown':
            return 'unknown';
        case 'object':
            return 'Record<string, unknown>';
        case 'binary':
            return 'Blob';
        case 'json':
            return 'JsonValue';
        default:
            return 'unknown';
    }
}

function renderTsInlineObject(fields: FieldNode[]): string {
    const entries = fields.map(f => {
        const opt = f.optional ? '?' : '';
        return `${f.name}${opt}: ${renderTsType(f.type)}`;
    });
    return `{ ${entries.join('; ')} }`;
}

// ─── Public entry point ────────────────────────────────────────────────────

export interface MarkdownCodegenContext {
    contractRoots: ContractRootNode[];
    opRoots: OpRootNode[];
}

export function generateMarkdown(ctx: MarkdownCodegenContext): string {
    const { contractRoots, opRoots } = ctx;
    const modelIndex = buildModelIndex(contractRoots);
    const lines: string[] = [];

    lines.push('# API Reference');
    lines.push('');

    // ── Collect grouped data ─────────────────────────────────────
    const endpointGroups = groupEndpoints(opRoots);
    const publicModels = computePubliclyReachableModels(opRoots, contractRoots);
    const modelGroups = groupModels(contractRoots, publicModels);

    // ── Table of Contents ────────────────────────────────────────
    const hasEndpoints = endpointGroups.length > 0;
    const hasModels = modelGroups.length > 0;

    if (hasEndpoints || hasModels) {
        lines.push('## Table of Contents');
        lines.push('');

        if (hasEndpoints) {
            lines.push('**Endpoints**');
            lines.push('');
            for (const group of endpointGroups) {
                if (group.area) {
                    lines.push('<details>');
                    lines.push(`<summary><strong>${titleCase(group.area)}</strong> (${group.endpoints.length})</summary>`);
                    lines.push('');
                }
                for (const ep of group.endpoints) {
                    const title = deriveTitle(ep.op, ep.route);
                    lines.push(`- [${title}](#${anchor(title)})`);
                }
                if (group.area) {
                    lines.push('');
                    lines.push('</details>');
                }
                lines.push('');
            }
        }

        if (hasModels) {
            lines.push('**Models**');
            lines.push('');
            for (const group of modelGroups) {
                if (group.area) {
                    lines.push('<details>');
                    lines.push(`<summary><strong>${titleCase(group.area)}</strong> (${group.models.length})</summary>`);
                    lines.push('');
                }
                for (const model of group.models) {
                    lines.push(`- [${model.name}](#${anchor(model.name)})`);
                }
                if (group.area) {
                    lines.push('');
                    lines.push('</details>');
                }
                lines.push('');
            }
        }

        lines.push('---');
        lines.push('');
    }

    // ── Endpoints ──────────────────────────────────────────────
    if (hasEndpoints) {
        lines.push('## Endpoints');
        lines.push('');

        for (const group of endpointGroups) {
            if (group.area) {
                lines.push(`### ${titleCase(group.area)}`);
                lines.push('');
            }

            let first = true;
            for (const ep of group.endpoints) {
                if (!first) {
                    lines.push('---');
                    lines.push('');
                }
                first = false;
                lines.push(...renderEndpoint(ep.route, ep.op, group.area !== undefined, modelIndex));
                lines.push('');
            }
        }
    }

    // ── Models ─────────────────────────────────────────────────
    if (hasModels) {
        lines.push('## Models');
        lines.push('');

        for (const group of modelGroups) {
            if (group.area) {
                lines.push(`### ${titleCase(group.area)}`);
                lines.push('');
            }

            for (const model of group.models) {
                lines.push(...renderModel(model, group.area !== undefined));
                lines.push('');
            }
        }
    }

    return lines.join('\n');
}

// ─── Model index ──────────────────────────────────────────────────────────

function buildModelIndex(contractRoots: ContractRootNode[]): Map<string, ModelNode> {
    const index = new Map<string, ModelNode>();
    for (const root of contractRoots) {
        for (const model of root.models) {
            index.set(model.name, model);
        }
    }
    return index;
}

/**
 * Resolve a model's fields, following the `base` chain for inheritance.
 * Returns fields in order: base fields first, then own fields.
 */
function resolveModelFields(name: string, modelIndex: Map<string, ModelNode>): FieldNode[] | undefined {
    const model = modelIndex.get(name);
    if (!model) return undefined;
    if (model.type) return undefined; // type alias, no fields

    const ownFields = model.fields;
    if (!model.base) return ownFields;

    const baseFields = resolveModelFields(model.base, modelIndex);
    if (!baseFields) return ownFields;

    return [...baseFields, ...ownFields];
}

// ─── Grouping ──────────────────────────────────────────────────────────────

interface EndpointEntry {
    route: OpRouteNode;
    op: OpOperationNode;
}

interface EndpointGroup {
    area: string | undefined;
    endpoints: EndpointEntry[];
}

interface ModelGroup {
    area: string | undefined;
    models: ModelNode[];
}

function groupEndpoints(opRoots: OpRootNode[]): EndpointGroup[] {
    const grouped = new Map<string, EndpointEntry[]>();
    const ungrouped: EndpointEntry[] = [];

    for (const opRoot of opRoots) {
        const area = opRoot.meta?.area;
        for (const route of opRoot.routes) {
            for (const op of route.operations) {
                const mods = resolveModifiers(route, op);
                if (mods.includes('internal')) continue;
                const entry: EndpointEntry = { route, op };
                if (area) {
                    const list = grouped.get(area) ?? [];
                    list.push(entry);
                    grouped.set(area, list);
                } else {
                    ungrouped.push(entry);
                }
            }
        }
    }

    const result: EndpointGroup[] = [];

    if (ungrouped.length > 0) {
        result.push({ area: undefined, endpoints: ungrouped });
    }

    for (const [area, endpoints] of grouped) {
        result.push({ area, endpoints });
    }

    return result;
}

/**
 * Returns the set of contract model names reachable from public (non-internal) operations,
 * transitively through model dependencies. Returns null when there are no .op files,
 * meaning all models should be shown.
 */
function computePubliclyReachableModels(opRoots: OpRootNode[], contractRoots: ContractRootNode[]): Set<string> | null {
    if (opRoots.length === 0) return null;

    // Seed with type names directly referenced by public ops
    const reachable = new Set<string>();
    for (const opRoot of opRoots) {
        for (const name of collectPublicTypeNames(opRoot)) {
            reachable.add(name);
        }
    }

    // Build model → dependency map
    const modelDeps = new Map<string, Set<string>>();
    for (const contractRoot of contractRoots) {
        for (const model of contractRoot.models) {
            const deps = new Set<string>();
            if (model.base) deps.add(model.base);
            if (model.type) collectTypeRefs(model.type, deps);
            for (const field of model.fields) collectTypeRefs(field.type, deps);
            modelDeps.set(model.name, deps);
        }
    }

    // BFS expand through dependencies
    const frontier = [...reachable];
    while (frontier.length > 0) {
        const name = frontier.pop()!;
        for (const dep of modelDeps.get(name) ?? []) {
            if (!reachable.has(dep)) {
                reachable.add(dep);
                frontier.push(dep);
            }
        }
    }

    return reachable;
}

function groupModels(contractRoots: ContractRootNode[], publicModels: Set<string> | null): ModelGroup[] {
    const grouped = new Map<string, ModelNode[]>();
    const ungrouped: ModelNode[] = [];

    for (const contractRoot of contractRoots) {
        const area = contractRoot.meta?.area;
        for (const model of contractRoot.models) {
            if (publicModels !== null && !publicModels.has(model.name)) continue;
            if (area) {
                const list = grouped.get(area) ?? [];
                list.push(model);
                grouped.set(area, list);
            } else {
                ungrouped.push(model);
            }
        }
    }

    const result: ModelGroup[] = [];

    if (ungrouped.length > 0) {
        result.push({ area: undefined, models: ungrouped });
    }

    for (const [area, models] of grouped) {
        result.push({ area, models });
    }

    return result;
}

// ─── Title derivation ─────────────────────────────────────────────────────

/**
 * Normalize verb to imperative mood.
 * "Creates a new account" → "Create a new account"
 * "Lists all accounts" → "List all accounts"
 * "Gets a ledger account" → "Get a ledger account"
 * "Finalizes a transaction" → "Finalize a transaction"
 *
 * Leaves words ending in 'ss' alone (e.g. "Process").
 */
function normalizeVerbTitle(title: string): string {
    const spaceIdx = title.indexOf(' ');
    if (spaceIdx === -1) return title;

    const firstWord = title.slice(0, spaceIdx);
    const rest = title.slice(spaceIdx);

    // Strip third-person 's' from verbs (but not from words ending in 'ss' like "Process")
    if (firstWord.length > 3 && firstWord.endsWith('s') && !firstWord.endsWith('ss')) {
        return firstWord.slice(0, -1) + rest;
    }

    return title;
}

/**
 * Derive a human-readable verb-based title for an endpoint.
 *
 * Priority:
 * 1. op.description (title-cased, normalized to imperative mood)
 * 2. Service method name (e.g. "LedgerService.createAccount" → "Create account")
 * 3. Fallback: method + path segments (e.g. "Get ledger accounts")
 */
function deriveTitle(op: OpOperationNode, route: OpRouteNode): string {
    // 1. Use explicit description
    if (op.description) {
        return normalizeVerbTitle(titleCase(op.description.trim()));
    }

    // 2. Derive from service method name
    if (op.service) {
        const methodPart = op.service.split('.').pop()!;
        // camelCase → space-separated, title-cased first word
        const words = methodPart.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        return titleCase(words);
    }

    // 3. Fallback: method + path segments
    const segments = route.path.split('/').filter(s => s.length > 0 && !s.startsWith('{'));
    const pathWords = segments.join(' ').replace(/[.-]/g, ' ');
    const verb = METHOD_VERBS[op.method] ?? op.method.toUpperCase();
    return `${verb} ${pathWords}`;
}

const METHOD_VERBS: Record<HttpMethod, string> = {
    get: 'List',
    post: 'Create',
    put: 'Update',
    patch: 'Update',
    delete: 'Delete',
};

// ─── Endpoint rendering ────────────────────────────────────────────────────

const STATUS_TEXT: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
};

function renderEndpoint(route: OpRouteNode, op: OpOperationNode, nested: boolean, modelIndex: Map<string, ModelNode>): string[] {
    const lines: string[] = [];
    const method = op.method.toUpperCase();
    const path = route.path;
    const title = deriveTitle(op, route);
    const methodName = deriveMethodName(op, route);
    const h = nested ? '####' : '###';
    const subH = nested ? '#####' : '####';

    // Title
    lines.push(`${h} ${title}`);
    lines.push('');

    // Deprecation notice
    const mods = resolveModifiers(route, op);
    if (mods.includes('deprecated')) {
        lines.push('> [!WARNING]');
        lines.push('> **Deprecated** — this endpoint is deprecated and may be removed in a future version.');
        lines.push('');
    }

    // Method badge + path (compact line)
    lines.push(`**\`${method}\`** \`${path}\``);
    lines.push('');

    // SDK method + security (GitHub admonition)
    lines.push('> [!NOTE]');
    lines.push(`> SDK method: \`${methodName}\``);
    const effectiveSecurity = resolveSecurity(route, op);
    if (effectiveSecurity === SECURITY_NONE) {
        lines.push('> Security: public');
    } else if (effectiveSecurity !== undefined) {
        const parts: string[] = [];
        if (effectiveSecurity.roles && effectiveSecurity.roles.length > 0) {
            parts.push(`roles: ${effectiveSecurity.roles.join(', ')}`);
        }
        if (op.signature) {
            parts.push(`signature: ${op.signature}`);
        }
        lines.push(`> Security: authenticated${parts.length > 0 ? ` (${parts.join('; ')})` : ''}`);
    }
    lines.push('');

    // Unified attributes table (path + query + headers merged)
    const attrs = collectAttributes(route, op, modelIndex);
    if (attrs.length > 0) {
        lines.push(`${subH} Attributes`);
        lines.push('');
        lines.push(...wrapCollapsible(`Attributes (${attrs.length})`, renderAttributesTable(attrs)));
        lines.push('');
    }

    // Request body — render one section per accepted content type
    if (op.request && op.request.bodies.length > 0) {
        for (const body of op.request.bodies) {
            lines.push(`${subH} Request body (\`${body.contentType}\`)`);
            lines.push('');

            if (body.bodyType.kind === 'inlineObject') {
                const writableFields = body.bodyType.fields.filter(f => f.visibility !== 'readonly');
                if (writableFields.length > 0) {
                    lines.push(...wrapCollapsible(`Attributes (${writableFields.length})`, renderFieldsTable(writableFields, { excludeReadonly: true })));
                    lines.push('');
                }
            } else {
                lines.push(typeProseLink(body.bodyType, 'Accepts'));
                lines.push('');
            }
        }
    }

    // Responses
    if (op.responses.length > 0) {
        lines.push(`${subH} Response`);
        lines.push('');

        for (const resp of op.responses) {
            const statusText = STATUS_TEXT[resp.statusCode] ?? '';
            const statusLabel = statusText ? `${resp.statusCode} ${statusText}` : `${resp.statusCode}`;

            if (!resp.bodyType) {
                lines.push(`\`${statusLabel}\``);
                lines.push('');
            } else if (resp.bodyType.kind === 'inlineObject') {
                // Inline objects — expand into field table
                lines.push(`\`${statusLabel}\``);
                lines.push('');
                if (resp.bodyType.fields.length > 0) {
                    lines.push(
                        ...wrapCollapsible(
                            `Attributes (${resp.bodyType.fields.length})`,
                            renderFieldsTable(resp.bodyType.fields, { excludeReadonly: false }),
                        ),
                    );
                    lines.push('');
                }
            } else {
                // Named type — reference it; the Models section has the full definition
                lines.push(`\`${statusLabel}\` — ${typeProseLink(resp.bodyType, 'Returns')}`);
                lines.push('');
            }

            if (resp.headers && resp.headers.length > 0) {
                const headerRows = resp.headers.map(h => {
                    const required = h.optional ? '' : ' *(required)*';
                    const desc = h.description ? escapeCell(h.description) : '';
                    return `| \`${h.name}\` | \`${escapeCell(renderTsType(h.type))}\`${required} | ${desc} |`;
                });
                lines.push('Response headers:');
                lines.push('');
                lines.push('| Header | Type | Description |');
                lines.push('| ------ | ---- | ----------- |');
                for (const r of headerRows) lines.push(r);
                lines.push('');
            }
        }
    }

    return lines;
}

// ─── Attributes collection ────────────────────────────────────────────────

interface AttributeEntry {
    name: string;
    type: ContractTypeNode;
    required: boolean;
    description: string;
    source: 'path' | 'query' | 'header';
}

function collectAttributes(route: OpRouteNode, op: OpOperationNode, modelIndex: Map<string, ModelNode>): AttributeEntry[] {
    const attrs: AttributeEntry[] = [];

    // Path parameters (always required, listed first)
    if (route.params) {
        const params = flattenParamSource(route.params, modelIndex);
        for (const p of params) {
            attrs.push({
                name: p.name,
                type: p.type,
                required: true,
                description: p.description ? `${p.description}. Path parameter.` : 'Path parameter.',
                source: 'path',
            });
        }
    }

    // Query parameters
    if (op.query) {
        const params = flattenParamSource(op.query, modelIndex);
        for (const p of params) {
            attrs.push({
                name: p.name,
                type: p.type,
                required: !p.optional,
                description: p.description ?? '',
                source: 'query',
            });
        }
    }

    // Header parameters
    if (op.headers) {
        const params = flattenParamSource(op.headers, modelIndex);
        for (const p of params) {
            attrs.push({
                name: p.name,
                type: p.type,
                required: !p.optional,
                description: p.description ?? '',
                source: 'header',
            });
        }
    }

    // Sort: path first, then required, then optional alphabetically
    attrs.sort((a, b) => {
        if (a.source === 'path' && b.source !== 'path') return -1;
        if (a.source !== 'path' && b.source === 'path') return 1;
        if (a.required && !b.required) return -1;
        if (!a.required && b.required) return 1;
        return a.name.localeCompare(b.name);
    });

    return attrs;
}

function renderAttributesTable(attrs: AttributeEntry[]): string[] {
    const lines: string[] = [];
    lines.push('| Attribute | Type | Required | Description |');
    lines.push('| --- | --- | --- | --- |');
    for (const attr of attrs) {
        const type = escapeCell(renderTsType(attr.type));
        const req = attr.required ? 'Yes' : 'No';
        lines.push(`| \`${attr.name}\` | \`${type}\` | ${req} | ${escapeCell(attr.description)} |`);
    }
    return lines;
}

// ─── Field / body helpers ─────────────────────────────────────────────────

interface FieldsTableOpts {
    excludeReadonly: boolean;
}

function renderFieldsTable(fields: FieldNode[], opts: FieldsTableOpts): string[] {
    const lines: string[] = [];
    lines.push('| Attribute | Type | Required | Description |');
    lines.push('| --- | --- | --- | --- |');

    for (const f of fields) {
        if (opts.excludeReadonly && f.visibility === 'readonly') continue;

        const type = escapeCell(renderTsType(f.type));
        const required = f.optional ? 'No' : 'Yes';
        const modifiers: string[] = [];
        if (f.visibility === 'readonly') modifiers.push('read-only');
        if (f.visibility === 'writeonly') modifiers.push('write-only');
        if (f.nullable) modifiers.push('nullable');
        if (f.default !== undefined) modifiers.push(`default: \`${f.default}\``);

        const desc = escapeCell([f.description, ...modifiers.map(m => `*${m}*`)].filter(Boolean).join('. '));
        lines.push(`| \`${f.name}\` | \`${type}\` | ${required} | ${desc} |`);
    }
    return lines;
}

/**
 * Generate prose-style reference text for a body type.
 * E.g. "Accepts a [CreateUser](#createuser) object."
 *      "Returns a list of [User](#user) objects."
 */
function typeProseLink(type: ContractTypeNode, verb: 'Accepts' | 'Returns'): string {
    if (type.kind === 'ref') {
        return `${verb} a [${type.name}](#${anchor(type.name)}) object.`;
    }
    if (type.kind === 'array' && type.item.kind === 'ref') {
        return `${verb} a list of [${type.item.name}](#${anchor(type.item.name)}) objects.`;
    }
    if (type.kind === 'union') {
        const allRefs = type.members.every(m => m.kind === 'ref');
        if (allRefs && type.members.length > 0) {
            const links = type.members.map(m => (m.kind === 'ref' ? `[${m.name}](#${anchor(m.name)})` : renderTsType(m)));
            return `${verb} a ${links.join(' or ')} object.`;
        }
    }
    return `${verb} \`${escapeCell(renderTsType(type))}\`.`;
}

// ─── Model rendering ──────────────────────────────────────────────────────

function renderModel(model: ModelNode, nested: boolean): string[] {
    const lines: string[] = [];
    const heading = nested ? '####' : '###';

    lines.push(`${heading} ${model.name}`);
    lines.push('');

    if (model.deprecated) {
        lines.push('> **Deprecated** — this type is deprecated and may be removed in a future version.');
        lines.push('');
    }

    if (model.description) {
        lines.push(`> ${model.description}`);
        lines.push('');
    }

    if (model.base) {
        lines.push(`Extends [\`${model.base}\`](#${anchor(model.base)})`);
        lines.push('');
    }

    // Type alias (no fields)
    if (model.type) {
        lines.push(`\`\`\`typescript`);
        lines.push(`type ${model.name} = ${renderTsType(model.type)}`);
        lines.push(`\`\`\``);
        return lines;
    }

    if (model.fields.length > 0) {
        const tableLines: string[] = [];
        tableLines.push('| Attribute | Type | Required | Description |');
        tableLines.push('| --- | --- | --- | --- |');

        for (const field of model.fields) {
            const type = escapeCell(renderTsType(field.type));
            const required = field.optional ? 'No' : 'Yes';
            const modifiers: string[] = [];
            if (field.deprecated) modifiers.push('deprecated');
            if (field.visibility === 'readonly') modifiers.push('read-only');
            if (field.visibility === 'writeonly') modifiers.push('write-only');
            if (field.nullable) modifiers.push('nullable');
            if (field.default !== undefined) modifiers.push(`default: \`${field.default}\``);

            const desc = escapeCell([field.description, ...modifiers.map(m => `*${m}*`)].filter(Boolean).join('. '));
            tableLines.push(`| \`${field.name}\` | \`${type}\` | ${required} | ${desc} |`);
        }

        lines.push(...wrapCollapsible(`Attributes (${model.fields.length})`, tableLines));
    }

    return lines;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface FlatParam {
    name: string;
    type: ContractTypeNode;
    optional: boolean;
    description?: string;
}

function flattenParamSource(source: ParamSource, modelIndex: Map<string, ModelNode>): FlatParam[] {
    if (source.kind === 'params') {
        return source.nodes.map(p => ({ name: p.name, type: p.type, optional: p.optional }));
    }
    if (source.kind === 'ref') {
        // String reference — resolve from model index
        const fields = resolveModelFields(source.name, modelIndex);
        if (fields) {
            return fields.map(f => ({
                name: f.name,
                type: f.type,
                optional: f.optional,
                description: f.description,
            }));
        }
        return [];
    }
    // ContractTypeNode
    const node = source.node;
    if (node.kind === 'inlineObject') {
        return node.fields.map(f => ({
            name: f.name,
            type: f.type,
            optional: f.optional,
            description: f.description,
        }));
    }
    if (node.kind === 'ref') {
        const fields = resolveModelFields(node.name, modelIndex);
        if (fields) {
            return fields.map(f => ({
                name: f.name,
                type: f.type,
                optional: f.optional,
                description: f.description,
            }));
        }
        return [];
    }
    if (node.kind === 'intersection') {
        // Flatten all members of the intersection
        const result: FlatParam[] = [];
        for (const member of node.members) {
            const memberParams = flattenParamSource({ kind: 'type', node: member }, modelIndex);
            result.push(...memberParams);
        }
        return result;
    }
    return [];
}

/** Wrap lines in a collapsible <details> block (collapsed by default). */
function wrapCollapsible(summary: string, tableLines: string[]): string[] {
    return ['<details>', `<summary>${summary}</summary>`, '', ...tableLines, '', '</details>'];
}

/** Escape pipe characters inside markdown table cells. */
function escapeCell(s: string): string {
    return s.replace(/\|/g, '\\|');
}

function anchor(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Derive SDK method name — mirrors codegen-sdk.ts logic. */
function deriveMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return op.sdk;
    const segments = route.path.split('/').filter(s => s.length > 0);
    const parts: string[] = [op.method.toLowerCase()];

    for (const seg of segments) {
        if (seg.startsWith('{')) {
            const paramName = seg.slice(1, -1);
            parts.push('By' + paramName.charAt(0).toUpperCase() + paramName.slice(1));
        } else {
            const segParts = seg.split(/[.-]/).filter(Boolean);
            for (const sp of segParts) {
                parts.push(sp.charAt(0).toUpperCase() + sp.slice(1));
            }
        }
    }

    return parts.join('');
}
