import type { ContractTypeNode, FieldNode, ModelNode, ScalarTypeNode } from '@contractkit/core';

/**
 * Emitters for the `reviveX` functions that rehydrate `decimal` fields in an SDK response.
 *
 * A decimal arrives as a quoted JSON string, but the generated types say `Decimal`, so something
 * has to construct one. The SDK cannot do it the way `bigint` does — `bigIntReviver` works only
 * because bigint invented a tagged `"123n"` wire encoding, and `"10.50"` is indistinguishable from
 * an ordinary string without knowing the schema. Nor can it re-parse the response through the Zod
 * schema: `XOutput` is a `z.output<>` type alias with no runtime value behind it, and models
 * default to `z.strictObject`, so any field the server added would throw in every deployed client.
 *
 * So the knowledge lives in generated code instead: one function per model that walks to the field
 * positions a decimal can occupy and converts in place. Mutating rather than rebuilding keeps the
 * cost proportional to the number of decimal fields, and preserves unknown server-added keys —
 * the forward compatibility a strict re-parse would destroy.
 *
 * Emitted from the AST, so zod mode and plain-types mode produce identical runtime behaviour.
 */

export interface ReviveCodegenOptions {
    /** Models that carry a revivable scalar, directly or transitively. Only these get a reviver. */
    modelsWithDecimal: Set<string>;
    /**
     * Which scalars need rehydrating from their wire form. Defaults to `decimal`, the only scalar
     * whose runtime type currently differs from what `JSON.parse` produces.
     *
     * A set rather than a boolean because the question a reviver asks is not "does this reach a
     * decimal" but "which conversion does this leaf need" — and the answer becomes plural as soon
     * as a second scalar joins.
     */
    revivableScalars?: ReadonlySet<ScalarTypeNode['name']>;
    /** Models with an `Output` variant, which need a second reviver keyed by the output casing. */
    modelsWithOutput?: Set<string>;
    /** Every model in scope, for resolving discriminated-union members to their literal tag. */
    modelMap?: Map<string, ModelNode>;
}

/** The per-file coercion helper. Emitted once in any file that declares a reviver. */
export const DECIMAL_COERCE_DECL = [
    `const __dec = (v: unknown, path: string): Decimal => {`,
    `    if (typeof v !== 'string') {`,
    `        throw new TypeError(\`ContractKit: expected a decimal string at '\${path}', received \${typeof v} — decimals must be sent as quoted JSON strings.\`);`,
    `    }`,
    `    try {`,
    `        return new Decimal(v);`,
    `    } catch {`,
    `        throw new TypeError(\`ContractKit: '\${v}' at '\${path}' is not a valid decimal.\`);`,
    `    }`,
    `};`,
];

/** `reviveInvoice` / `reviveInvoiceOutput`. */
export function reviveFnName(model: string, variant: 'base' | 'output' = 'base'): string {
    return `revive${model}${variant === 'output' ? 'Output' : ''}`;
}

function applyCase(name: string, caseTransform: 'camel' | 'snake' | 'pascal' | undefined): string {
    if (!caseTransform || caseTransform === 'camel') return name;
    if (caseTransform === 'snake') return name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The default of {@link ReviveCodegenOptions.revivableScalars}. */
export const DEFAULT_REVIVABLE_SCALARS: ReadonlySet<ScalarTypeNode['name']> = new Set(['decimal']);

/** Whether a type reaches a revivable scalar, following refs through `modelsWithDecimal`. */
export function typeReachesDecimal(type: ContractTypeNode, opts: ReviveCodegenOptions): boolean {
    switch (type.kind) {
        case 'scalar':
            return (opts.revivableScalars ?? DEFAULT_REVIVABLE_SCALARS).has(type.name);
        case 'ref':
            return opts.modelsWithDecimal.has(type.name);
        case 'array':
            return typeReachesDecimal(type.item, opts);
        case 'lazy':
            return typeReachesDecimal(type.inner, opts);
        case 'tuple':
            return type.items.some(t => typeReachesDecimal(t, opts));
        case 'record':
            // Value only, deliberately unlike `typeHasScalar` in core, which also checks the key.
            // That one answers "is this scalar mentioned", which decides imports; this one answers
            // "is there a value to rehydrate", and a JSON object key is always a string — there is
            // nothing at a key position for a reviver to convert.
            return typeReachesDecimal(type.value, opts);
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            return type.members.some(t => typeReachesDecimal(t, opts));
        case 'inlineObject':
            return type.fields.some(f => typeReachesDecimal(f.type, opts));
        default:
            return false;
    }
}

/** Fresh local names, so nested loops in one function body cannot collide. */
class Scope {
    private n = 0;
    next(prefix: string): string {
        return `__${prefix}${this.n++}`;
    }
}

/**
 * Statements that hydrate `slot` — an assignable expression — in place.
 *
 * `path` is threaded purely for the error message; it is what tells a consumer *which* field of a
 * large response was malformed.
 */
function emit(slot: string, type: ContractTypeNode, path: string, opts: ReviveCodegenOptions, scope: Scope, variant: 'base' | 'output'): string[] {
    switch (type.kind) {
        case 'scalar':
            return type.name === 'decimal' ? [`${slot} = __dec(${slot}, '${path}');`] : [];

        case 'ref':
            return opts.modelsWithDecimal.has(type.name) ? [`${reviveRefName(type.name, opts, variant)}(${slot} as never);`] : [];

        case 'lazy':
            return emit(slot, type.inner, path, opts, scope, variant);

        case 'array': {
            if (!typeReachesDecimal(type.item, opts)) return [];
            const arr = scope.next('a');
            const i = scope.next('i');
            const inner = emit(`${arr}[${i}]`, type.item, `${path}[]`, opts, scope, variant);
            return [
                `{`,
                `    const ${arr} = ${slot} as unknown[];`,
                `    for (let ${i} = 0; ${i} < ${arr}.length; ${i}++) {`,
                ...inner.map(l => `        ${l}`),
                `    }`,
                `}`,
            ];
        }

        case 'tuple': {
            const items = type.items.flatMap((t, idx) =>
                typeReachesDecimal(t, opts) ? emit(`(${slot} as unknown[])[${idx}]`, t, `${path}[${idx}]`, opts, scope, variant) : [],
            );
            return items;
        }

        case 'record': {
            if (!typeReachesDecimal(type.value, opts)) return [];
            const rec = scope.next('r');
            const k = scope.next('k');
            const inner = emit(`${rec}[${k}]`, type.value, `${path}{}`, opts, scope, variant);
            return [
                `{`,
                `    const ${rec} = ${slot} as Record<string, unknown>;`,
                `    for (const ${k} of Object.keys(${rec})) {`,
                ...inner.map(l => `        ${l}`),
                `    }`,
                `}`,
            ];
        }

        case 'inlineObject': {
            const relevant = type.fields.filter(f => typeReachesDecimal(f.type, opts));
            if (relevant.length === 0) return [];
            const obj = scope.next('o');
            const body = relevant.flatMap(f => fieldStatements(obj, f, path, opts, scope, variant, undefined));
            return [`{`, `    const ${obj} = ${slot} as Record<string, unknown>;`, ...body.map(l => `    ${l}`), `}`];
        }

        case 'intersection':
            return type.members.flatMap(m => emit(slot, m, path, opts, scope, variant));

        case 'union': {
            // `validateDecimal` rejects a decimal in a union with more than one non-null member, so
            // anything reaching here is `T | null`: hydrate the single real member behind a guard.
            const real = type.members.filter(m => !(m.kind === 'scalar' && m.name === 'null'));
            const target = real.find(m => typeReachesDecimal(m, opts));
            if (!target) return [];
            const inner = emit(slot, target, path, opts, scope, variant);
            return [`if (${slot} != null) {`, ...inner.map(l => `    ${l}`), `}`];
        }

        case 'discriminatedUnion': {
            const branches: string[] = [];
            const disc = scope.next('d');
            for (const member of type.members) {
                if (!typeReachesDecimal(member, opts)) continue;
                const tag = discriminatorTag(member, type.discriminator, opts);
                const inner = emit(slot, member, path, opts, scope, variant);
                if (inner.length === 0) continue;
                if (tag === undefined) {
                    // No resolvable literal: hydrating unconditionally could apply the wrong arm's
                    // shape, so skip it rather than risk corrupting a sibling member's field.
                    continue;
                }
                branches.push(`    if (${disc} === ${JSON.stringify(tag)}) {`, ...inner.map(l => `        ${l}`), `    }`);
            }
            if (branches.length === 0) return [];
            return [`{`, `    const ${disc} = (${slot} as Record<string, unknown>)[${JSON.stringify(type.discriminator)}];`, ...branches, `}`];
        }

        default:
            return [];
    }
}

/** The literal value that selects `member` in a discriminated union, when it can be resolved. */
function discriminatorTag(member: ContractTypeNode, discriminator: string, opts: ReviveCodegenOptions): string | number | boolean | undefined {
    const fields: FieldNode[] | undefined =
        member.kind === 'inlineObject' ? member.fields : member.kind === 'ref' ? opts.modelMap?.get(member.name)?.fields : undefined;
    const field = fields?.find(f => f.name === discriminator);
    if (field?.type.kind === 'literal') return field.type.value;
    // A single-valued enum is the other way a discriminator gets written.
    if (field?.type.kind === 'enum' && field.type.values.length === 1) return field.type.values[0];
    return undefined;
}

/** Statements for one field of an object held in `objVar`. */
function fieldStatements(
    objVar: string,
    field: FieldNode,
    path: string,
    opts: ReviveCodegenOptions,
    scope: Scope,
    variant: 'base' | 'output',
    outputCase: 'camel' | 'snake' | 'pascal' | undefined,
): string[] {
    const key = variant === 'output' ? applyCase(field.name, outputCase) : field.name;
    const slot = `${objVar}[${JSON.stringify(key)}]`;
    const inner = emit(slot, field.type, `${path}.${key}`, opts, scope, variant);
    if (inner.length === 0) return [];
    // A union already emits its own null guard; adding a second would just nest.
    if (field.type.kind === 'union') return inner;
    if (field.optional || field.nullable) {
        return [`if (${slot} != null) {`, ...inner.map(l => `    ${l}`), `}`];
    }
    return inner;
}

/**
 * Pick the reviver for a referenced model.
 *
 * Mirrors `renderOutputTsType`: inside an output reviver, a referenced model uses its *own* output
 * reviver only if it has one. `computeModelsWithOutput` propagates referrer→referenced, so a child
 * of a transformed parent is not itself transformed and keeps camelCase keys.
 */
function reviveRefName(name: string, opts: ReviveCodegenOptions, variant: 'base' | 'output'): string {
    if (variant === 'output' && opts.modelsWithOutput?.has(name)) return reviveFnName(name, 'output');
    return reviveFnName(name, 'base');
}

/**
 * A standalone reviver for an arbitrary type node — used for a response body that is not a plain
 * model reference (an inline object, a record, a tuple), where there is no `reviveX` to call.
 *
 * Returns `null` when the type holds no decimal, so the caller emits nothing at all.
 */
export function renderInlineReviver(
    fnName: string,
    tsType: string,
    type: ContractTypeNode,
    opts: ReviveCodegenOptions,
    variant: 'base' | 'output' = 'output',
): string[] | null {
    if (!typeReachesDecimal(type, opts)) return null;
    const scope = new Scope();
    const body = emit('__v[0]', type, fnName.replace(/^__revive/, ''), opts, scope, variant);
    if (body.length === 0) return null;
    return [
        `/** Rehydrates the \`decimal\` fields of one response body. Mutates and returns \`raw\`. */`,
        `function ${fnName}(raw: ${tsType}): ${tsType} {`,
        `    const __v = [raw] as unknown[];`,
        ...body.map(l => `    ${l}`),
        `    return __v[0] as ${tsType};`,
        `}`,
    ];
}

/** The `reviveX` (and `reviveXOutput`) declarations for one model, or `[]` if it holds no decimal. */
export function renderReviveFunctions(model: ModelNode, opts: ReviveCodegenOptions): string[] {
    if (!opts.modelsWithDecimal.has(model.name)) return [];
    const lines = renderOne(model, opts, 'base');
    if (opts.modelsWithOutput?.has(model.name)) {
        lines.push('');
        lines.push(...renderOne(model, opts, 'output'));
    }
    return lines;
}

function renderOne(model: ModelNode, opts: ReviveCodegenOptions, variant: 'base' | 'output'): string[] {
    const scope = new Scope();
    const typeName = `${model.name}${variant === 'output' ? 'Output' : ''}`;
    const fnName = reviveFnName(model.name, variant);

    // A type-alias model has no fields — hydrate the aliased type as a whole.
    if (model.type) {
        const body = emit('__v[0]', model.type, model.name, opts, scope, variant);
        if (body.length === 0) return [];
        return [
            `/** Rehydrates every \`decimal\` in a ${typeName} from its wire string. Mutates and returns \`raw\`. */`,
            `export function ${fnName}(raw: ${typeName}): ${typeName} {`,
            `    const __v = [raw] as unknown[];`,
            ...body.map(l => `    ${l}`),
            `    return __v[0] as ${typeName};`,
            `}`,
        ];
    }

    const obj = scope.next('o');
    const body = model.fields.flatMap(f =>
        typeReachesDecimal(f.type, opts) ? fieldStatements(obj, f, model.name, opts, scope, variant, model.outputCase) : [],
    );
    if (body.length === 0) return [];

    return [
        `/** Rehydrates every \`decimal\` in a ${typeName} from its wire string. Mutates and returns \`raw\`. */`,
        `export function ${fnName}(raw: ${typeName}): ${typeName} {`,
        `    const ${obj} = raw as unknown as Record<string, unknown>;`,
        ...body.map(l => `    ${l}`),
        `    return raw;`,
        `}`,
    ];
}
