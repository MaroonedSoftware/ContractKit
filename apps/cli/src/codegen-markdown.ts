import type {
    DtoRootNode,
    OpRootNode,
    OpRouteNode,
    OpOperationNode,
    DtoTypeNode,
    FieldNode,
    ModelNode,
    ParamSource,
    OpParamNode,
    HttpMethod,
    IntersectionTypeNode,
} from './ast.js';
import { renderTsType } from './codegen-sdk.js';

// ─── Public entry point ────────────────────────────────────────────────────

export interface MarkdownCodegenContext {
    dtoRoots: DtoRootNode[];
    opRoots: OpRootNode[];
}

export function generateMarkdown(ctx: MarkdownCodegenContext): string {
    const { dtoRoots, opRoots } = ctx;
    const modelIndex = buildModelIndex(dtoRoots);
    const lines: string[] = [];

    lines.push('# API Reference');
    lines.push('');

    // ── Collect grouped data ─────────────────────────────────────
    const endpointGroups = groupEndpoints(opRoots);
    const modelGroups = groupModels(dtoRoots);

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
                    lines.push(`- [${titleCase(group.area)}](#${anchor(group.area)})`);
                }
                for (const ep of group.endpoints) {
                    const title = deriveTitle(ep.op, ep.route);
                    lines.push(`  - [${title}](#${anchor(title)})`);
                }
            }
            lines.push('');
        }

        if (hasModels) {
            lines.push('**Models**');
            lines.push('');
            for (const group of modelGroups) {
                if (group.area) {
                    lines.push(`- [${titleCase(group.area)}](#${anchor(group.area + '-models')})`);
                }
                for (const model of group.models) {
                    lines.push(`  - [${model.name}](#${anchor(model.name)})`);
                }
            }
            lines.push('');
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

            for (const ep of group.endpoints) {
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

function buildModelIndex(dtoRoots: DtoRootNode[]): Map<string, ModelNode> {
    const index = new Map<string, ModelNode>();
    for (const root of dtoRoots) {
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

function groupModels(dtoRoots: DtoRootNode[]): ModelGroup[] {
    const grouped = new Map<string, ModelNode[]>();
    const ungrouped: ModelNode[] = [];

    for (const dtoRoot of dtoRoots) {
        const area = dtoRoot.meta?.area;
        for (const model of dtoRoot.models) {
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
 * Derive a human-readable verb-based title for an endpoint.
 *
 * Priority:
 * 1. op.description (title-cased)
 * 2. Service method name (e.g. "LedgerService.createAccount" → "Create account")
 * 3. Fallback: method + path segments (e.g. "Get ledger accounts")
 */
function deriveTitle(op: OpOperationNode, route: OpRouteNode): string {
    // 1. Use explicit description
    if (op.description) {
        return titleCase(op.description.trim());
    }

    // 2. Derive from service method name
    if (op.service) {
        const methodPart = op.service.split('.').pop()!;
        // camelCase → space-separated, title-cased first word
        const words = methodPart.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        return titleCase(words);
    }

    // 3. Fallback: method + path segments
    const segments = route.path.split('/').filter(s => s.length > 0 && !s.startsWith(':'));
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

function renderEndpoint(
    route: OpRouteNode,
    op: OpOperationNode,
    nested: boolean,
    modelIndex: Map<string, ModelNode>,
): string[] {
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

    // Method + path in code block
    lines.push('```plaintext');
    lines.push(`${method} ${path}`);
    lines.push('```');
    lines.push('');

    // SDK method
    lines.push(`**SDK method:** \`${methodName}\``);
    lines.push('');

    // Unified attributes table (path + query + headers merged)
    const attrs = collectAttributes(route, op, modelIndex);
    if (attrs.length > 0) {
        lines.push(`${subH} Attributes`);
        lines.push('');
        lines.push(...wrapCollapsible(`Attributes (${attrs.length})`, renderAttributesTable(attrs)));
        lines.push('');
    }

    // Request body
    if (op.request) {
        lines.push(`${subH} Request body`);
        lines.push('');
        lines.push(`Content type: \`${op.request.contentType}\``);
        lines.push('');

        const bodyFields = resolveBodyFields(op.request.bodyType, modelIndex);
        if (bodyFields) {
            // Show type link for navigation
            const typeLink = renderTypeWithLink(op.request.bodyType);
            if (typeLink !== renderTsType(op.request.bodyType) || op.request.bodyType.kind === 'ref') {
                lines.push(`Type: ${typeLink}`);
                lines.push('');
            }
            // Exclude readonly fields from request body
            const writableFields = bodyFields.filter(f => f.visibility !== 'readonly');
            if (writableFields.length > 0) {
                lines.push(...wrapCollapsible(
                    `Attributes (${writableFields.length})`,
                    renderFieldsTable(writableFields, { excludeReadonly: true }),
                ));
                lines.push('');
            }
        } else {
            lines.push(renderTypeWithLink(op.request.bodyType));
            lines.push('');
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
                lines.push(`Status: \`${statusLabel}\``);
                lines.push('');
                continue;
            }

            const ct = resp.contentType ?? 'application/json';
            lines.push(`Status: \`${statusLabel}\`, Content type: \`${ct}\``);
            lines.push('');

            // Expand response body fields
            const respFields = resolveBodyFields(resp.bodyType, modelIndex);
            if (respFields) {
                const typeLink = renderTypeWithLink(resp.bodyType);
                if (typeLink !== renderTsType(resp.bodyType) || resp.bodyType.kind === 'ref') {
                    lines.push(`Type: ${typeLink}`);
                    lines.push('');
                }
                if (respFields.length > 0) {
                    lines.push(...wrapCollapsible(
                        `Attributes (${respFields.length})`,
                        renderFieldsTable(respFields, { excludeReadonly: false }),
                    ));
                    lines.push('');
                }
            } else {
                lines.push(renderTypeWithLink(resp.bodyType));
                lines.push('');
            }
        }
    }

    return lines;
}

// ─── Attributes collection ────────────────────────────────────────────────

interface AttributeEntry {
    name: string;
    type: DtoTypeNode;
    required: boolean;
    description: string;
    source: 'path' | 'query' | 'header';
}

function collectAttributes(
    route: OpRouteNode,
    op: OpOperationNode,
    modelIndex: Map<string, ModelNode>,
): AttributeEntry[] {
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

// ─── Field / body expansion ───────────────────────────────────────────────

function resolveBodyFields(type: DtoTypeNode, modelIndex: Map<string, ModelNode>): FieldNode[] | undefined {
    if (type.kind === 'ref') {
        return resolveModelFields(type.name, modelIndex);
    }
    if (type.kind === 'inlineObject') {
        return type.fields;
    }
    return undefined;
}

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

// ─── Model rendering ──────────────────────────────────────────────────────

function renderModel(model: ModelNode, nested: boolean): string[] {
    const lines: string[] = [];
    const heading = nested ? '####' : '###';

    lines.push(`${heading} ${model.name}`);
    lines.push('');

    if (model.description) {
        lines.push(model.description);
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
    type: DtoTypeNode;
    optional: boolean;
    description?: string;
}

function flattenParamSource(source: ParamSource, modelIndex: Map<string, ModelNode>): FlatParam[] {
    if (Array.isArray(source)) {
        return (source as OpParamNode[]).map(p => ({ name: p.name, type: p.type, optional: false }));
    }
    if (typeof source === 'string') {
        // String reference — resolve from model index
        const fields = resolveModelFields(source, modelIndex);
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
    if (source.kind === 'inlineObject') {
        return source.fields.map(f => ({
            name: f.name,
            type: f.type,
            optional: f.optional,
            description: f.description,
        }));
    }
    if (source.kind === 'ref') {
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
    if (source.kind === 'intersection') {
        // Flatten all members of the intersection
        const result: FlatParam[] = [];
        for (const member of source.members) {
            const memberParams = flattenParamSource(member, modelIndex);
            result.push(...memberParams);
        }
        return result;
    }
    return [];
}

function renderTypeWithLink(type: DtoTypeNode): string {
    if (type.kind === 'ref') {
        return `[${type.name}](#${anchor(type.name)})`;
    }
    if (type.kind === 'array' && type.item.kind === 'ref') {
        return `[${type.item.name}](#${anchor(type.item.name)})[]`;
    }
    return renderTsType(type);
}

/** Wrap lines in a collapsible <details> block (collapsed by default). */
function wrapCollapsible(summary: string, tableLines: string[]): string[] {
    return [
        '<details>',
        `<summary>${summary}</summary>`,
        '',
        ...tableLines,
        '',
        '</details>',
    ];
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
        if (seg.startsWith(':')) {
            const paramName = seg.slice(1);
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
