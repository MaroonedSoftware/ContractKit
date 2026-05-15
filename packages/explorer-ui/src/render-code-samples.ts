import type { ContractTypeNode, ModelNode, ScalarTypeNode } from '@contractkit/core';
import { resolveEffectiveFields } from '@contractkit/core/type-utils';
import { faker } from '@faker-js/faker';
import { escapeHtml } from './html.js';
import type { RenderContext, ResolvedOperation } from './types.js';

/**
 * Renders the right-rail code samples: a curl Request Sample and (when a 2xx JSON response is
 * declared) a synthesized Response Example. Used by `renderOperation` on wide viewports — the
 * card switches to a two-column grid and places this output in the right rail.
 */
export function renderCodeSamples(op: ResolvedOperation, baseUrl: string, ctx: RenderContext = {}): string {
    const curl = renderCurlSample(op, baseUrl, ctx);
    const responseExample = renderResponseExample(op, ctx);
    return `<section class="ce-rail-section">
        <h4 class="ce-rail-heading">Request Sample</h4>
        <pre class="ce-code ce-code-dark">${curl}</pre>
    </section>
    ${responseExample}`;
}

function renderCurlSample(op: ResolvedOperation, baseUrl: string, ctx: RenderContext): string {
    const cleanBase = baseUrl ? baseUrl.replace(/\/$/, '') : 'https://api.example.com';
    const url = `${cleanBase}${op.routePath}`;
    const lines: string[] = [];
    lines.push(`curl --request ${op.method.toUpperCase()} \\`);
    lines.push(`  --url ${url}`);

    const hasJsonResponse = op.op.responses.some(r => r.contentType?.includes('json'));
    const jsonBody = op.op.request?.bodies.find(
        b => b.contentType === 'application/json' || b.contentType.endsWith('+json'),
    );

    if (hasJsonResponse) {
        lines[lines.length - 1] += ' \\';
        lines.push(`  --header 'Accept: application/json'`);
    }
    if (jsonBody) {
        lines[lines.length - 1] += ' \\';
        lines.push(`  --header 'Content-Type: application/json'`);
        // Append a `--data` argument with a faker-generated sample matching the request body
        // schema. Same seed key as the Try-It pre-fill so the curl payload and the textarea
        // sample stay aligned.
        const sample = buildSampleJson(
            jsonBody.bodyType,
            ctx,
            `${op.method}:${op.routePath}:request-body`,
            'readonly',
        );
        const bodyJson = JSON.stringify(sample, null, 2)
            // Single-quote-wrap the body, so escape any inner single quotes.
            .replace(/'/g, `'\\''`);
        lines[lines.length - 1] += ' \\';
        lines.push(`  --data '${bodyJson}'`);
    }

    return escapeHtml(lines.join('\n'));
}

function renderResponseExample(op: ResolvedOperation, ctx: RenderContext): string {
    const primary = op.op.responses.find(
        r =>
            r.statusCode >= 200 &&
            r.statusCode < 300 &&
            r.bodyType !== undefined &&
            r.contentType !== undefined &&
            r.contentType.includes('json'),
    );
    if (!primary || !primary.bodyType) return '';

    // Seed faker deterministically off the operation + status code so re-renders are stable.
    faker.seed(hashString(`${op.method}:${op.routePath}:${primary.statusCode}`));

    const sample = jsonSample(primary.bodyType, ctx, new Set(), undefined, 'writeonly');
    const formatted = JSON.stringify(sample, null, 2);
    return `<section class="ce-rail-section">
        <h4 class="ce-rail-heading">Response Example</h4>
        <pre class="ce-code ce-code-dark">${escapeHtml(formatted)}</pre>
    </section>`;
}

type Excluded = 'readonly' | 'writeonly';

function jsonSample(
    type: ContractTypeNode,
    ctx: RenderContext,
    visited: Set<string>,
    fieldName: string | undefined,
    exclude: Excluded,
): unknown {
    switch (type.kind) {
        case 'scalar':
            return scalarSample(type, fieldName);
        case 'literal':
            return type.value;
        case 'enum':
            return type.values.length > 0 ? faker.helpers.arrayElement(type.values) : null;
        case 'array': {
            const len = faker.number.int({ min: 1, max: 3 });
            return Array.from({ length: len }, () => jsonSample(type.item, ctx, visited, fieldName, exclude));
        }
        case 'tuple':
            return type.items.map(t => jsonSample(t, ctx, visited, fieldName, exclude));
        case 'record':
            return { key: jsonSample(type.value, ctx, visited, undefined, exclude) };
        case 'union':
        case 'discriminatedUnion': {
            const first = type.members[0];
            return first ? jsonSample(first, ctx, visited, fieldName, exclude) : null;
        }
        case 'intersection': {
            // Flatten the intersection via the canonical resolver, then sample each field.
            const resolved = resolveEffectiveFields(type, modelIndexFromCtx(ctx));
            if (resolved.fields.length > 0) {
                const out: Record<string, unknown> = {};
                for (const f of resolved.fields) {
                    if (f.visibility === exclude) continue;
                    out[f.name] = jsonSample(f.type, ctx, visited, f.name, exclude);
                }
                return out;
            }
            const first = type.members[0];
            return first ? jsonSample(first, ctx, visited, fieldName, exclude) : null;
        }
        case 'lazy':
            return jsonSample(type.inner, ctx, visited, fieldName, exclude);
        case 'inlineObject': {
            const out: Record<string, unknown> = {};
            for (const f of type.fields) {
                if (f.visibility === exclude) continue;
                out[f.name] = jsonSample(f.type, ctx, visited, f.name, exclude);
            }
            return out;
        }
        case 'ref': {
            if (visited.has(type.name)) return null;
            const entry = ctx.models?.get(type.name);
            if (!entry) return null;
            const next = new Set([...visited, type.name]);
            const resolved = resolveEffectiveFields(type.name, modelIndexFromCtx(ctx));
            if (resolved.fields.length > 0) {
                const out: Record<string, unknown> = {};
                for (const f of resolved.fields) {
                    if (f.visibility === exclude) continue;
                    out[f.name] = jsonSample(f.type, ctx, next, f.name, exclude);
                }
                return out;
            }
            // Model resolved to no fields (e.g. alias to a non-object type) — fall through.
            const model = entry.model;
            if (model.type) return jsonSample(model.type, ctx, next, fieldName, exclude);
            return null;
        }
    }
}

/**
 * Public sample-data factory. Used by `renderTryIt` to pre-fill the request body textarea and
 * the path/query/header inputs with realistic faker-generated values matching the schema.
 *
 * The `seed` makes output stable per-call: the same operation always pre-fills the same body
 * so users don't see flicker on re-render. `exclude: 'readonly'` is correct for request bodies
 * (readonly fields are server-controlled), `'writeonly'` for response examples.
 */
export function buildSampleJson(
    type: ContractTypeNode,
    ctx: RenderContext,
    seed: string,
    exclude: Excluded = 'writeonly',
): unknown {
    faker.seed(hashString(seed));
    return jsonSample(type, ctx, new Set(), undefined, exclude);
}

function scalarSample(s: ScalarTypeNode, fieldName: string | undefined): unknown {
    switch (s.name) {
        case 'boolean':
            return faker.datatype.boolean();
        case 'number':
        case 'int':
        case 'bigint':
            return fakerNumber(fieldName, s);
        case 'uuid':
            return faker.string.uuid();
        case 'datetime':
            return faker.date.recent({ days: 90 }).toISOString();
        case 'date':
            return faker.date.recent({ days: 90 }).toISOString().slice(0, 10);
        case 'time':
            return faker.date.recent({ days: 1 }).toISOString().slice(11, 19);
        case 'interval':
            return 'P1D';
        case 'email':
            return faker.internet.email().toLowerCase();
        case 'url':
            return faker.internet.url();
        case 'string':
            return fakerString(fieldName);
        default:
            return fakerString(fieldName);
    }
}

function fakerString(fieldName: string | undefined): string {
    const name = (fieldName ?? '').toLowerCase();

    if (/email/.test(name)) return faker.internet.email().toLowerCase();
    if (/^url$|link|href|website/.test(name)) return faker.internet.url();
    if (/^id$|_id$|guid|uuid/.test(name)) return faker.string.uuid();
    if (/at$|_at$|date|time/.test(name)) return faker.date.recent({ days: 90 }).toISOString();

    if (/firstname|first_name/.test(name)) return faker.person.firstName();
    if (/lastname|last_name|surname/.test(name)) return faker.person.lastName();
    if (/^name$|fullname|full_name|displayname|display_name/.test(name)) return faker.person.fullName();
    if (/username|handle/.test(name)) return faker.internet.username();
    if (/avatar|image|photo|picture/.test(name)) return faker.image.url();
    if (/street|address/.test(name)) return faker.location.streetAddress();
    if (/city/.test(name)) return faker.location.city();
    if (/country/.test(name)) return faker.location.country();
    if (/zip|postal/.test(name)) return faker.location.zipCode();
    if (/state\b|region/.test(name)) return faker.location.state();
    if (/company|organization|org\b/.test(name)) return faker.company.name();
    if (/title|product|item/.test(name)) return faker.commerce.productName();
    if (/color|colour/.test(name)) return faker.color.human();
    if (/description|summary|bio|notes|message|content/.test(name)) return faker.lorem.sentence();
    if (/phone/.test(name)) return faker.phone.number();
    if (/password/.test(name)) return faker.internet.password();
    if (/token|key|secret|apikey/.test(name)) return faker.string.alphanumeric(32);
    if (/status|state/.test(name)) return faker.helpers.arrayElement(['active', 'inactive', 'pending', 'archived', 'draft']);
    if (/currency/.test(name)) return faker.finance.currencyCode();
    if (/locale|language/.test(name)) return faker.helpers.arrayElement(['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'es-ES']);
    if (/slug/.test(name)) return faker.lorem.slug();

    return faker.lorem.word();
}

function fakerNumber(fieldName: string | undefined, s: ScalarTypeNode): number {
    const name = (fieldName ?? '').toLowerCase();
    if (/amount|price|cost|total|balance|fee|salary|revenue/.test(name)) {
        return Number(faker.finance.amount({ min: 1, max: 9999, dec: 2 }));
    }
    if (/^age$/.test(name)) return faker.number.int({ min: 18, max: 80 });
    if (/year/.test(name)) return faker.number.int({ min: 2000, max: 2024 });
    if (/month/.test(name)) return faker.number.int({ min: 1, max: 12 });
    if (/day/.test(name)) return faker.number.int({ min: 1, max: 28 });
    if (/count|quantity|qty/.test(name)) return faker.number.int({ min: 1, max: 100 });
    if (/percent|pct|ratio/.test(name)) return faker.number.int({ min: 0, max: 100 });
    if (/latitude|lat\b/.test(name)) return Number(faker.location.latitude().toFixed(2));
    if (/longitude|lng\b|lon\b/.test(name)) return Number(faker.location.longitude().toFixed(2));

    const lo = toFiniteNumber(s.min, 0);
    const hi = toFiniteNumber(s.max, Math.max(lo + 1, 999));
    if (s.name === 'int' || s.name === 'bigint') {
        return faker.number.int({ min: lo, max: hi });
    }
    return Number(faker.number.float({ min: lo, max: hi, fractionDigits: 2 }));
}

function toFiniteNumber(value: number | bigint | string | undefined, fallback: number): number {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : fallback;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? Math.floor(n) : fallback;
    }
    return fallback;
}

/** Adapter that builds a plain ModelNode index from the RenderContext's ResolvedModel map. */
function modelIndexFromCtx(ctx: RenderContext): Map<string, ModelNode> {
    const out = new Map<string, ModelNode>();
    if (ctx.models) {
        for (const [name, resolved] of ctx.models) out.set(name, resolved.model);
    }
    return out;
}

function hashString(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h >>> 0;
}
