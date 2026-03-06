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
} from './ast.js';
import { renderTsType } from './codegen-sdk.js';

// ─── Public entry point ────────────────────────────────────────────────────

export interface MarkdownCodegenContext {
    dtoRoots: DtoRootNode[];
    opRoots: OpRootNode[];
}

export function generateMarkdown(ctx: MarkdownCodegenContext): string {
    const { dtoRoots, opRoots } = ctx;
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
                    const label = `\`${ep.op.method.toUpperCase()}\` ${ep.route.path}`;
                    lines.push(`  - [${label}](#${endpointAnchor(ep.op, ep.route)})`);
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
                lines.push(...renderEndpoint(ep.route, ep.op, group.area !== undefined));
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

    // Ungrouped first (no area heading)
    if (ungrouped.length > 0) {
        result.push({ area: undefined, endpoints: ungrouped });
    }

    // Then grouped by area
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

// ─── Endpoint rendering ────────────────────────────────────────────────────

function renderEndpoint(route: OpRouteNode, op: OpOperationNode, nested: boolean): string[] {
    const lines: string[] = [];
    const method = op.method.toUpperCase();
    const path = route.path;
    const methodName = deriveMethodName(op, route);
    const heading = nested ? '####' : '###';

    lines.push(`${heading} \`${method} ${path}\``);
    lines.push('');

    if (op.description) {
        lines.push(`> ${op.description}`);
        lines.push('');
    }

    lines.push(`**SDK method:** \`${methodName}\``);
    lines.push('');

    // Path parameters
    if (route.params) {
        const params = flattenParamSource(route.params);
        if (params.length > 0) {
            lines.push('**Path parameters:**');
            lines.push('');
            lines.push('| Name | Type | Description |');
            lines.push('| --- | --- | --- |');
            for (const p of params) {
                lines.push(`| \`${p.name}\` | \`${renderTsType(p.type)}\` | |`);
            }
            lines.push('');
        }
    }

    // Query parameters
    if (op.query) {
        const params = flattenParamSource(op.query);
        if (params.length > 0) {
            lines.push('**Query parameters:**');
            lines.push('');
            lines.push('| Name | Type | Required | Description |');
            lines.push('| --- | --- | --- | --- |');
            for (const p of params) {
                lines.push(`| \`${p.name}\` | \`${renderTsType(p.type)}\` | ${p.optional ? 'No' : 'Yes'} | |`);
            }
            lines.push('');
        } else if (typeof op.query === 'string') {
            lines.push(`**Query:** [\`${op.query}\`](#${anchor(op.query)})`);
            lines.push('');
        } else if (!Array.isArray(op.query) && op.query.kind === 'ref') {
            lines.push(`**Query:** [\`${op.query.name}\`](#${anchor(op.query.name)})`);
            lines.push('');
        }
    }

    // Request body
    if (op.request) {
        lines.push(`**Request body** (\`${op.request.contentType}\`):`);
        lines.push('');
        lines.push(`\`${renderTypeWithLink(op.request.bodyType)}\``);
        lines.push('');
    }

    // Responses
    if (op.responses.length > 0) {
        lines.push('**Responses:**');
        lines.push('');
        lines.push('| Status | Content Type | Body |');
        lines.push('| --- | --- | --- |');
        for (const resp of op.responses) {
            const ct = resp.contentType ?? '-';
            const body = resp.bodyType ? `\`${renderTypeWithLink(resp.bodyType)}\`` : '-';
            lines.push(`| ${resp.statusCode} | ${ct} | ${body} |`);
        }
        lines.push('');
    }

    lines.push('---');

    return lines;
}

// ─── Model rendering ──────────────────────────────────────────────────────

function renderModel(model: ModelNode, nested: boolean): string[] {
    const lines: string[] = [];
    const heading = nested ? '####' : '###';

    lines.push(`${heading} ${model.name}`);
    lines.push('');

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
        lines.push('| Field | Type | Required | Description |');
        lines.push('| --- | --- | --- | --- |');

        for (const field of model.fields) {
            const type = renderTsType(field.type);
            const required = field.optional ? 'No' : 'Yes';
            const modifiers: string[] = [];
            if (field.visibility === 'readonly') modifiers.push('read-only');
            if (field.visibility === 'writeonly') modifiers.push('write-only');
            if (field.nullable) modifiers.push('nullable');
            if (field.default !== undefined) modifiers.push(`default: \`${field.default}\``);

            const desc = [field.description, ...modifiers.map(m => `*${m}*`)].filter(Boolean).join('. ');
            lines.push(`| \`${field.name}\` | \`${type}\` | ${required} | ${desc} |`);
        }
    }

    return lines;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function flattenParamSource(source: ParamSource): { name: string; type: DtoTypeNode; optional: boolean }[] {
    if (Array.isArray(source)) {
        return (source as OpParamNode[]).map(p => ({ name: p.name, type: p.type, optional: false }));
    }
    if (typeof source !== 'string' && source.kind === 'inlineObject') {
        return source.fields.map(f => ({ name: f.name, type: f.type, optional: f.optional }));
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

function anchor(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function endpointAnchor(op: OpOperationNode, route: OpRouteNode): string {
    return anchor(`${op.method.toUpperCase()} ${route.path}`);
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
