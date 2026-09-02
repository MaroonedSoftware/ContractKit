import {
    ContractRootNode,
    OpRootNode,
    OpRouteNode,
    OpOperationNode,
    ContractTypeNode,
    ScalarTypeNode,
    FieldNode,
    ModelNode,
    ParamSource,
    resolveModifiers,
    resolveSecurity,
    SECURITY_NONE,
} from '@contractkit/core';
import { computePubliclyReachableModels, groupEndpoints, groupModels, humanize } from '../../naming.js';

// ─── Local TypeScript type rendering ─────────────────────────────────────

function renderTsType(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return renderTsScalar(type.name);
        case 'array': {
            const inner = renderTsType(type.item);
            const needsParens =
                type.item.kind === 'union' ||
                type.item.kind === 'discriminatedUnion' ||
                type.item.kind === 'intersection' ||
                type.item.kind === 'enum';
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

/**
 * Render a ContractKit scalar type name as its TypeScript type string
 * (e.g. `uuid` → `string`, `int` → `number`, `datetime`/`interval` → `string`).
 *
 * Exported for unit testing. Throws on an unmapped scalar name so a newly added
 * scalar surfaces as a hard error instead of silently rendering as `unknown`.
 */
export function renderTsScalar(name: ScalarTypeNode['name']): string {
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
        case 'decimal':
            // Quoted string on the wire, rehydrated into a decimal.js `Decimal` by the SDK.
            return 'Decimal';
        case 'boolean':
            return 'boolean';
        case 'date':
        case 'time':
        case 'datetime':
        case 'duration':
        case 'interval':
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
        default: {
            const _exhaustive: never = name;
            throw new Error(`plugin-docs (markdown): unmapped scalar '${String(_exhaustive)}' — add a case`);
        }
    }
}

function renderTsInlineObject(fields: FieldNode[]): string {
    const entries = fields.map(f => {
        const opt = f.optional ? '?' : '';
        return `${f.name}${opt}: ${renderTsType(f.type)}`;
    });
    return `{ ${entries.join('; ')} }`;
}

// ─── Rendering dialect ─────────────────────────────────────────────────────

/**
 * A callout block: a short bolded lead-in plus one paragraph of soft-wrapped lines.
 *
 * `lines` are the lines of a single paragraph, not separate paragraphs — a dialect is free to
 * join them or to keep the soft breaks.
 */
export interface Admonition {
    kind: 'note' | 'warning';
    /** Bolded lead-in, e.g. `Deprecated`. Omitted for an untitled callout. */
    title?: string;
    lines: string[];
}

/**
 * The parts of Markdown that differ between the platforms rendering it.
 *
 * Everything else — tables, code fences, `<details>` — is the same everywhere, so only callouts
 * and cross-references are behind this seam. A target supplies one dialect and reuses the whole
 * renderer; see {@link githubDialect} for the flavour {@link generateMarkdown} emits.
 */
export interface MarkdownDialect {
    admonition(block: Admonition): string[];
    /**
     * Link target for a model reference, or `undefined` when the model has no page to link to,
     * in which case the name renders as plain code.
     */
    modelLink(name: string): string | undefined;
}

/** Lower-case the first letter, so a title folded into a sentence reads as its opening. */
function lowerFirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * GitHub-flavored Markdown: alert blockquotes, and cross-references as in-document anchors
 * because the whole reference is one file.
 *
 * A title is folded into the first line as `**Title** — …` rather than given its own line, which
 * is how GitHub's alerts are conventionally written; the sentence continues from the title, so
 * its first letter is lower-cased on the way in.
 */
export const githubDialect: MarkdownDialect = {
    admonition(block) {
        const [first = '', ...rest] = block.lines;
        const lead = block.title ? `**${block.title}** — ${lowerFirst(first)}` : first;
        return [`> [!${block.kind.toUpperCase()}]`, ...[lead, ...rest].map(line => `> ${line}`)];
    },
    modelLink(name) {
        return `#${anchor(name)}`;
    },
};

/** Render a model reference: a link when the dialect has one, plain code when it does not. */
function modelRef(name: string, dialect: MarkdownDialect, code: boolean): string {
    const label = code ? `\`${name}\`` : name;
    const link = dialect.modelLink(name);
    return link ? `[${label}](${link})` : `\`${name}\``;
}

/** `##`, `###`, … for a heading level. */
function hashes(level: number): string {
    return '#'.repeat(level);
}

// ─── Public entry point ────────────────────────────────────────────────────

/** Inputs for {@link generateMarkdown} — the parsed contract and operation roots plus render options. */
export interface MarkdownCodegenContext {
    contractRoots: ContractRootNode[];
    opRoots: OpRootNode[];
    /**
     * Whether to document operations marked `internal`. Defaults to `false` — internal ops
     * are omitted from the rendered reference. Set to `true` for an internal-use doc.
     */
    includeInternal?: boolean;
}

/**
 * Render a complete Markdown API reference from parsed contract and operation roots.
 * Emits a table of contents, an Endpoints section, and a Models section — each grouped
 * by `keys.area` when present. Internal operations (and models reachable only from them)
 * are omitted unless `ctx.includeInternal` is set.
 */
export function generateMarkdown(ctx: MarkdownCodegenContext): string {
    const { contractRoots, opRoots } = ctx;
    const includeInternal = ctx.includeInternal ?? false;
    const modelIndex = buildModelIndex(contractRoots);
    const lines: string[] = [];

    lines.push('# API Reference');
    lines.push('');

    // ── Collect grouped data ─────────────────────────────────────
    const endpointGroups = groupEndpoints(opRoots, includeInternal);
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
                    lines.push(`<summary><strong>${humanize(group.area)}</strong> (${group.endpoints.length})</summary>`);
                    lines.push('');
                }
                for (const ep of group.endpoints) {
                    const title = ep.title;
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
                    lines.push(`<summary><strong>${humanize(group.area)}</strong> (${group.models.length})</summary>`);
                    lines.push('');
                }
                for (const { model } of group.models) {
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
                lines.push(`### ${humanize(group.area)}`);
                lines.push('');
            }

            let first = true;
            for (const ep of group.endpoints) {
                if (!first) {
                    lines.push('---');
                    lines.push('');
                }
                first = false;
                const nested = group.area !== undefined;
                lines.push(`${nested ? '####' : '###'} ${ep.title}`);
                lines.push('');
                lines.push(
                    ...renderEndpointBody(ep.route, ep.op, {
                        subHeadingLevel: nested ? 5 : 4,
                        dialect: githubDialect,
                        modelIndex,
                    }),
                );
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
                lines.push(`### ${humanize(group.area)}`);
                lines.push('');
            }

            for (const { model } of group.models) {
                lines.push(`${group.area !== undefined ? '####' : '###'} ${model.name}`);
                lines.push('');
                lines.push(...renderModelBody(model, githubDialect));
                lines.push('');
            }
        }
    }

    return lines.join('\n');
}

// ─── Model index ──────────────────────────────────────────────────────────

/** Every model by name, for resolving a reference to the fields it stands for. */
export function buildModelIndex(contractRoots: ContractRootNode[]): Map<string, ModelNode> {
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
    if (!model.bases || model.bases.length === 0) return ownFields;

    const collected: FieldNode[] = [];
    for (const base of model.bases) {
        const baseFields = resolveModelFields(base, modelIndex);
        if (baseFields) collected.push(...baseFields);
    }
    return [...collected, ...ownFields];
}

// ─── Grouping ──────────────────────────────────────────────────────────────

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

/** What a target needs to supply to render one endpoint's body. */
export interface EndpointBodyOptions {
    /** Heading level for the endpoint's own subsections (Attributes, Request body, Response). */
    subHeadingLevel: number;
    dialect: MarkdownDialect;
    /** Models by name, for resolving a `params:`/`query:`/`headers:` reference to its fields. */
    modelIndex: Map<string, ModelNode>;
}

/**
 * Everything an endpoint's page holds below its title: the deprecation callout, the method and
 * path, the SDK and security note, the attributes table, the request bodies and the responses.
 *
 * The title itself is the caller's, because a single-document target writes it as a heading while
 * a page-per-endpoint target writes it as frontmatter.
 */
export function renderEndpointBody(route: OpRouteNode, op: OpOperationNode, opts: EndpointBodyOptions): string[] {
    const { dialect, modelIndex } = opts;
    const lines: string[] = [];
    const method = op.method.toUpperCase();
    const path = route.path;
    const methodName = deriveMethodName(op, route);
    const subH = hashes(opts.subHeadingLevel);

    // Deprecation notice
    const mods = resolveModifiers(route, op);
    if (mods.includes('deprecated')) {
        lines.push(
            ...dialect.admonition({
                kind: 'warning',
                title: 'Deprecated',
                lines: ['This endpoint is deprecated and may be removed in a future version.'],
            }),
        );
        lines.push('');
    }

    // Method badge + path (compact line)
    lines.push(`**\`${method}\`** \`${path}\``);
    lines.push('');

    // SDK method + security
    const note = [`SDK method: \`${methodName}\``];
    const effectiveSecurity = resolveSecurity(route, op);
    if (effectiveSecurity === SECURITY_NONE) {
        note.push('Security: public');
    } else if (effectiveSecurity !== undefined) {
        const parts: string[] = [];
        if (effectiveSecurity.policy !== undefined) {
            parts.push(`policy: ${effectiveSecurity.policy === false ? 'none' : effectiveSecurity.policy}`);
        }
        if (op.signature) {
            parts.push(`signature: ${op.signature}${op.signaturePolicy ? ` (policy: ${op.signaturePolicy})` : ''}`);
        }
        note.push(`Security: authenticated${parts.length > 0 ? ` (${parts.join('; ')})` : ''}`);
    }
    lines.push(...dialect.admonition({ kind: 'note', lines: note }));
    lines.push('');

    // Unified attributes table (path + query + headers merged)
    const attrs = collectAttributes(route, op, modelIndex);
    if (attrs.length > 0) {
        lines.push(`${subH} Attributes`);
        lines.push('');
        lines.push(...wrapCollapsible(`Attributes (${attrs.length})`, renderAttributesTable(attrs, dialect)));
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
                    lines.push(
                        ...wrapCollapsible(
                            `Attributes (${writableFields.length})`,
                            renderFieldsTable(writableFields, { excludeReadonly: true }, dialect),
                        ),
                    );
                    lines.push('');
                }
            } else {
                lines.push(typeProseLink(body.bodyType, 'Accepts', dialect));
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
            const bodies = resp.bodies;

            if (bodies.length === 0) {
                lines.push(`\`${statusLabel}\``);
                lines.push('');
            }
            // A status may serve several formats, so each declared mime gets its own line under
            // the one status heading.
            for (const [i, body] of bodies.entries()) {
                // Repeat the status on the first line only; the rest read as alternatives to it.
                const label = i === 0 ? `\`${statusLabel}\`` : `\`${resp.statusCode}\``;
                const mime = bodies.length > 1 ? ` \`${body.contentType}\`` : '';
                if (body.bodyType.kind === 'inlineObject') {
                    // Inline objects — expand into field table
                    lines.push(`${label}${mime}`);
                    lines.push('');
                    if (body.bodyType.fields.length > 0) {
                        lines.push(
                            ...wrapCollapsible(
                                `Attributes (${body.bodyType.fields.length})`,
                                renderFieldsTable(body.bodyType.fields, { excludeReadonly: false }, dialect),
                            ),
                        );
                        lines.push('');
                    }
                } else {
                    // Named type — reference it; the model's own page or section has the definition
                    lines.push(`${label}${mime} — ${typeProseLink(body.bodyType, 'Returns', dialect)}`);
                    lines.push('');
                }
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

function renderAttributesTable(attrs: AttributeEntry[], _dialect: MarkdownDialect): string[] {
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

function renderFieldsTable(fields: FieldNode[], opts: FieldsTableOpts, _dialect: MarkdownDialect): string[] {
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
 *
 * A model the dialect has no link for renders as plain code instead.
 */
function typeProseLink(type: ContractTypeNode, verb: 'Accepts' | 'Returns', dialect: MarkdownDialect): string {
    if (type.kind === 'ref') {
        return `${verb} a ${modelRef(type.name, dialect, false)} object.`;
    }
    if (type.kind === 'array' && type.item.kind === 'ref') {
        return `${verb} a list of ${modelRef(type.item.name, dialect, false)} objects.`;
    }
    if (type.kind === 'union') {
        const allRefs = type.members.every(m => m.kind === 'ref');
        if (allRefs && type.members.length > 0) {
            const links = type.members.map(m => (m.kind === 'ref' ? modelRef(m.name, dialect, false) : renderTsType(m)));
            return `${verb} a ${links.join(' or ')} object.`;
        }
    }
    return `${verb} \`${escapeCell(renderTsType(type))}\`.`;
}

// ─── Model rendering ──────────────────────────────────────────────────────

/**
 * Everything a model's page holds below its name: the deprecation callout, the description, the
 * bases it extends, and either its type alias or its field table. The name itself is the caller's,
 * for the same reason {@link renderEndpointBody} leaves out the endpoint title.
 */
export function renderModelBody(model: ModelNode, dialect: MarkdownDialect): string[] {
    const lines: string[] = [];

    if (model.deprecated) {
        lines.push(
            ...dialect.admonition({
                kind: 'warning',
                title: 'Deprecated',
                lines: ['This type is deprecated and may be removed in a future version.'],
            }),
        );
        lines.push('');
    }

    if (model.description) {
        // A description spans as many lines as the doc comment did, and every one of them needs
        // the marker or the block quote ends at the first line break.
        for (const line of model.description.split('\n')) lines.push(`> ${line}`);
        lines.push('');
    }

    if (model.bases && model.bases.length > 0) {
        const links = model.bases.map(b => modelRef(b, dialect, true)).join(', ');
        lines.push(`Extends ${links}`);
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

/** Escape pipe characters and collapse newlines inside markdown table cells. */
function escapeCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}

function anchor(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

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
