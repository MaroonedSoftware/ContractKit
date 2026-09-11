import type { ContractTypeNode, FieldNode, ModelNode, ScalarTypeNode } from '@contractkit/core';
import { escapeSingleQuoted } from './ts-render.js';
import { appliedCasing, applyKeyCase, requestWireFields } from './codegen-wire-input.js';

/**
 * Emitters for the `serializeX` functions that put an SDK request body into the text the server
 * parses. The request-side mirror of `codegen-revive`.
 *
 * A body goes out through `JSON.stringify` (or `URLSearchParams`), and three scalars do not
 * stringify the way the router reads them back:
 *
 * - `date` and `time` are luxon `DateTime`s, whose `toJSON()` is a full ISO timestamp. The router
 *   parses them with `DateTime.fromFormat` against the contract's `format` (`yyyy-MM-dd` and
 *   `HH:mm:ss` by default), so `{ day: DateTime.fromISO('2026-09-11') }` went out as
 *   `"2026-09-11T00:00:00.000-04:00"` and came back a 400.
 * - `decimal` stringifies in exponential notation outside decimal.js's `toExpNeg`/`toExpPos`
 *   range unless something has applied the global config, so `0.00000001` went out as `"1e-8"`.
 *   `toFixed()` with no argument is exact and always in normal notation.
 *
 * `datetime` and `duration` need nothing: their `toJSON()` is the ISO form `fromISO` reads. A
 * `bigint` is left to `bigIntReplacer`.
 *
 * Which conversion a value needs depends on the field it sits in, not on its runtime class: a
 * `date` and a `datetime` are both a `DateTime`. So the knowledge lives in generated code, one
 * function per model that walks to every position such a scalar can occupy, exactly as the revivers
 * do. Unlike a reviver it copies rather than mutates, along the path to each value it rewrites:
 * the object belongs to the caller, who may send it twice or keep using it.
 *
 * Each leaf goes through a small helper that converts only a value of its own class and passes
 * anything else through. That keeps a plain-JavaScript caller who already sends `'2026-09-11'`
 * working, and is what lets a union with one temporal member convert it without knowing which
 * member arrived. The class tests are the ones `DateTime.isDateTime` and `Decimal.isDecimal` make,
 * spelled out so a types file needs no luxon or decimal.js import it would not otherwise have: a
 * model's serializer walks the fields it inherits from a base in another file, whose scalars this
 * file may never name.
 */

/** A key casing that renames something. */
type KeyCase = 'snake' | 'pascal' | undefined;

export interface SerializeCodegenOptions {
    /** Models that get a `serializeX`, from {@link computeModelsWithSerializer}. */
    modelsWithSerializer: Set<string>;
    /**
     * Every model in scope, for a model's inherited fields, a type alias's target and a
     * discriminated-union member's tag.
     */
    modelMap: Map<string, ModelNode>;
}

/** `serializeInvoice`. */
export function serializeFnName(model: string): string {
    return `serialize${model}`;
}

/**
 * The luxon format a `date` or `time` travels in: the contract's own, else the one the router's
 * schema defaults to. `undefined` for every other scalar.
 */
export function temporalWireFormat(type: ScalarTypeNode): string | undefined {
    if (type.name === 'date') return type.format ?? 'yyyy-MM-dd';
    if (type.name === 'time') return type.format ?? 'HH:mm:ss';
    return undefined;
}

/**
 * The per-file leaf helpers, keyed by the call prefix that identifies them in emitted text. A file
 * gets only the ones it calls, decided by {@link wireDeclsFor}, the same text-derived idiom as
 * `coerceDeclsFor`.
 */
export const WIRE_DECLS: Record<string, string[]> = {
    '__wireDt(': [
        `/** A luxon DateTime in \`fmt\`, as the server's \`DateTime.fromFormat\` reads it. Anything else is returned as it is. */`,
        `const __wireDt = (v: unknown, fmt: string): unknown =>`,
        `    (v as { isLuxonDateTime?: unknown } | null | undefined)?.isLuxonDateTime === true ? (v as { toFormat(fmt: string): string }).toFormat(fmt) : v;`,
    ],
    '__wireDec(': [
        `/** A decimal.js value in normal notation, which its \`toString()\` is not at every magnitude. Anything else is returned as it is. */`,
        `const __wireDec = (v: unknown): unknown =>`,
        `    (v as { toStringTag?: unknown } | null | undefined)?.toStringTag === '[object Decimal]' ? (v as { toFixed(): string }).toFixed() : v;`,
    ],
};

/** The helper declarations `lines` actually calls, in a stable order. */
export function wireDeclsFor(lines: string[]): string[] {
    const haystack = lines.join('\n');
    return Object.entries(WIRE_DECLS)
        .filter(([prefix]) => haystack.includes(prefix))
        .flatMap(([, decl]) => decl);
}

/** Fresh local names, so nested blocks in one function body cannot collide. */
class Scope {
    private n = 0;
    next(prefix: string): string {
        return `__${prefix}${this.n++}`;
    }
}

const indent = (lines: string[], by = '    '): string[] => lines.map(l => `${by}${l}`);

/**
 * What a value of `type` can be at run time, for telling a union's members apart:
 * - `temporal`: a luxon `DateTime` (`date`, `time`, `datetime`)
 * - `decimal`: a decimal.js `Decimal`
 * - `object`: any other object or array
 * - `primitive`: a string, number, boolean, bigint or null
 *
 * Aliases and `lazy()` are followed to what they name. A nested union counts as an object, which
 * only ever makes a member harder to pick out, never easier.
 */
type RuntimeKind = 'temporal' | 'decimal' | 'object' | 'primitive';

function runtimeKind(type: ContractTypeNode, modelMap: Map<string, ModelNode>, seen: Set<string> = new Set()): RuntimeKind {
    switch (type.kind) {
        case 'lazy':
            return runtimeKind(type.inner, modelMap, seen);
        case 'ref': {
            const model = modelMap.get(type.name);
            if (model?.type && !seen.has(model.name)) return runtimeKind(model.type, modelMap, new Set(seen).add(model.name));
            return 'object';
        }
        case 'scalar':
            switch (type.name) {
                case 'date':
                case 'time':
                case 'datetime':
                    return 'temporal';
                case 'decimal':
                    return 'decimal';
                case 'duration':
                case 'binary':
                case 'json':
                case 'unknown':
                case 'object':
                    return 'object';
                default:
                    return 'primitive';
            }
        case 'enum':
        case 'literal':
            return 'primitive';
        default:
            return 'object';
    }
}

/**
 * Statements that rewrite `slot`, an assignable expression, into its wire form. Every non-empty
 * result ends by assigning `slot`, and never writes into the object `slot` held on entry.
 *
 * `keyCase` is the `format(input=)` casing an inline object here is keyed by. It reaches through
 * arrays, unions, intersections and `lazy()`, but not into a tuple or a record, and a referenced
 * model keys itself: the same reach `renderWireInputTsType` gives it, because that is the schema's.
 */
function emit(slot: string, type: ContractTypeNode, keyCase: KeyCase, opts: SerializeCodegenOptions, scope: Scope): string[] {
    switch (type.kind) {
        case 'scalar': {
            const fmt = temporalWireFormat(type);
            if (fmt !== undefined) return [`${slot} = __wireDt(${slot}, '${escapeSingleQuoted(fmt)}');`];
            if (type.name === 'decimal') return [`${slot} = __wireDec(${slot});`];
            return [];
        }

        case 'ref':
            return opts.modelsWithSerializer.has(type.name) ? [`${slot} = ${serializeFnName(type.name)}(${slot} as never);`] : [];

        case 'lazy':
            return emit(slot, type.inner, keyCase, opts, scope);

        case 'array': {
            const arr = scope.next('a');
            const i = scope.next('i');
            const inner = emit(`${arr}[${i}]`, type.item, keyCase, opts, scope);
            if (inner.length === 0) return [];
            return [
                `{`,
                `    const ${arr} = [...(${slot} as unknown[])];`,
                `    for (let ${i} = 0; ${i} < ${arr}.length; ${i}++) {`,
                ...indent(inner, '        '),
                `    }`,
                `    ${slot} = ${arr};`,
                `}`,
            ];
        }

        case 'tuple': {
            const tup = scope.next('t');
            const items = type.items.flatMap((t, idx) => emit(`${tup}[${idx}]`, t, undefined, opts, scope));
            if (items.length === 0) return [];
            return [`{`, `    const ${tup} = [...(${slot} as unknown[])];`, ...indent(items), `    ${slot} = ${tup};`, `}`];
        }

        case 'record': {
            const rec = scope.next('r');
            const k = scope.next('k');
            const inner = emit(`${rec}[${k}]`, type.value, undefined, opts, scope);
            if (inner.length === 0) return [];
            return [
                `{`,
                `    const ${rec} = { ...(${slot} as Record<string, unknown>) };`,
                `    for (const ${k} of Object.keys(${rec})) {`,
                ...indent(inner, '        '),
                `    }`,
                `    ${slot} = ${rec};`,
                `}`,
            ];
        }

        case 'inlineObject': {
            const obj = scope.next('o');
            const body = type.fields.flatMap(f => fieldStatements(obj, applyKeyCase(f.name, keyCase), f, keyCase, opts, scope));
            if (body.length === 0) return [];
            return [`{`, `    const ${obj} = { ...(${slot} as Record<string, unknown>) };`, ...indent(body), `    ${slot} = ${obj};`, `}`];
        }

        case 'intersection':
            // Each member rewrites the fields it declares, on the copy the member before it made.
            return type.members.flatMap(m => emit(slot, m, keyCase, opts, scope));

        case 'union':
            return unionStatements(slot, type.members, keyCase, opts, scope);

        case 'discriminatedUnion': {
            const disc = scope.next('d');
            const branches: string[] = [];
            for (const member of type.members) {
                const inner = emit(slot, member, keyCase, opts, scope);
                if (inner.length === 0) continue;
                // No resolvable tag: rewriting unconditionally could apply this member's formats to
                // a sibling's fields, so the member is left as `toJSON` writes it.
                const tag = discriminatorTag(member, type.discriminator, keyCase, opts);
                if (!tag) continue;
                branches.push(
                    `    if (${disc}[${JSON.stringify(tag.key)}] === ${JSON.stringify(tag.value)}) {`,
                    ...indent(inner, '        '),
                    `    }`,
                );
            }
            if (branches.length === 0) return [];
            // Read before any branch runs: a branch replaces `slot` with its copy, which keeps the
            // tag, so a later branch still sees the one that arrived.
            return [`{`, `    const ${disc} = ${slot} as Record<string, unknown>;`, ...branches, `}`];
        }

        default:
            return [];
    }
}

/**
 * A plain union: rewrite each member only where a value's runtime class says it is that member.
 *
 * - A `date`, `time` or `decimal` member is rewritten through its helper, which touches nothing but
 *   a value of its own class, so it needs no guard. It is skipped when another member shares the
 *   class: `date | time` has no single format to apply, and `date | datetime` cannot tell a date
 *   from a timestamp.
 * - Any other member that needs rewriting is an object or an array, and is rewritten only when it
 *   is the one member a value can be an object for. `Line | null` qualifies; `Line | Note` does not,
 *   and applying `Line`'s formats to a `Note` could rewrite a field `Note` declares differently.
 *
 * `T | null` is the common case, and falls out of the second rule with no special handling.
 */
function unionStatements(slot: string, members: ContractTypeNode[], keyCase: KeyCase, opts: SerializeCodegenOptions, scope: Scope): string[] {
    const alternatives = members.filter(m => !(m.kind === 'scalar' && m.name === 'null'));
    const kinds = alternatives.map(m => runtimeKind(m, opts.modelMap));
    const nonPrimitive = kinds.filter(k => k !== 'primitive').length;
    const out: string[] = [];
    alternatives.forEach((member, idx) => {
        const inner = emit(slot, member, keyCase, opts, scope);
        if (inner.length === 0) return;
        const kind = kinds[idx]!;
        if (kind === 'temporal' || kind === 'decimal') {
            if (kinds.filter(k => k === kind).length === 1) out.push(...inner);
        } else if (nonPrimitive === 1) {
            out.push(`if (typeof ${slot} === 'object' && ${slot} !== null) {`, ...indent(inner), `}`);
        }
    });
    return out;
}

/**
 * The key and literal that select `member` of a discriminated union in a request, when they can be
 * resolved. The key is the wire spelling: an inline member is keyed by the enclosing casing, a
 * referenced model by its own.
 */
function discriminatorTag(
    member: ContractTypeNode,
    discriminator: string,
    keyCase: KeyCase,
    opts: SerializeCodegenOptions,
): { key: string; value: string | number | boolean } | undefined {
    let key: string | undefined;
    let field: FieldNode | undefined;
    if (member.kind === 'inlineObject') {
        field = member.fields.find(f => f.name === discriminator);
        key = applyKeyCase(discriminator, keyCase);
    } else if (member.kind === 'ref') {
        const model = opts.modelMap.get(member.name);
        const wire = model ? requestWireFields(model, opts.modelMap).find(f => f.field.name === discriminator) : undefined;
        field = wire?.field;
        key = wire?.key;
    }
    if (!field || key === undefined) return undefined;
    if (field.type.kind === 'literal') return { key, value: field.type.value };
    // A single-valued enum is the other way a discriminator gets written.
    if (field.type.kind === 'enum' && field.type.values.length === 1) return { key, value: field.type.values[0]! };
    return undefined;
}

/**
 * Statements for one field of the object held in `objVar`, under its wire `key`.
 *
 * A field the caller may leave out (`?`, a default, or `null`) is guarded, so a key that was absent
 * stays absent. `JSON.stringify` would drop an `undefined` anyway, but `URLSearchParams` writes it
 * out as the text "undefined".
 */
function fieldStatements(objVar: string, key: string, field: FieldNode, keyCase: KeyCase, opts: SerializeCodegenOptions, scope: Scope): string[] {
    const slot = `${objVar}[${JSON.stringify(key)}]`;
    const inner = emit(slot, field.type, keyCase, opts, scope);
    if (inner.length === 0) return [];
    if (field.optional || field.nullable || field.default !== undefined) return [`if (${slot} != null) {`, ...indent(inner), `}`];
    return inner;
}

/**
 * Statements for every field a request carries for `model`, under the keys its `XWireInput` (or
 * `XInput`) spells: inherited fields included, readonly ones left out, as `requestWireFields`
 * reads them. Walking the inherited fields here rather than calling a base's serializer is what
 * keeps an `override` that changes a field's type or format correct.
 */
function modelFieldStatements(model: ModelNode, objVar: string, opts: SerializeCodegenOptions, scope: Scope): string[] {
    const keyCase = appliedCasing(model, opts.modelMap).input;
    return requestWireFields(model, opts.modelMap).flatMap(({ key, field }) => fieldStatements(objVar, key, field, keyCase, opts, scope));
}

/** Whether `model` has anything to rewrite, given the models known so far to have a serializer. */
function modelNeedsSerializer(model: ModelNode, opts: SerializeCodegenOptions): boolean {
    const scope = new Scope();
    return model.type ? emit('__v', model.type, undefined, opts, scope).length > 0 : modelFieldStatements(model, '__o', opts, scope).length > 0;
}

/**
 * Which models get a `serializeX`: those whose request form holds a `date`, `time` or `decimal` in
 * a position a serializer can reach, directly, through a base, or through a model they reference.
 *
 * Decided by the emitter itself rather than by a scalar scan, so a model that holds one only in a
 * readonly field, or in a union member no value can be told apart as, gets no empty function that
 * its callers would then import.
 *
 * @param models Every model in scope, across all files, so a reference into another file counts.
 */
export function computeModelsWithSerializer(
    models: ModelNode[],
    modelMap: Map<string, ModelNode> = new Map(models.map(m => [m.name, m])),
): Set<string> {
    const result = new Set<string>();
    const opts = { modelsWithSerializer: result, modelMap };
    // Adding a model can only make more of the others need one, so this settles.
    let changed = true;
    while (changed) {
        changed = false;
        for (const model of models) {
            if (result.has(model.name) || !modelNeedsSerializer(model, opts)) continue;
            result.add(model.name);
            changed = true;
        }
    }
    return result;
}

/** Whether a request body of `type` has anything to rewrite. */
export function typeNeedsSerializer(type: ContractTypeNode, opts: SerializeCodegenOptions): boolean {
    return emit('__v', type, undefined, opts, new Scope()).length > 0;
}

/**
 * The `serializeX` declaration for one model, or `[]` if it has none.
 *
 * @param paramType The type the SDK sends the model as: its `XWireInput`, `XInput` or own name.
 */
export function renderSerializeFunction(model: ModelNode, paramType: string, opts: SerializeCodegenOptions): string[] {
    if (!opts.modelsWithSerializer.has(model.name)) return [];
    const scope = new Scope();
    const fnName = serializeFnName(model.name);
    const doc = `/** ${model.name} as a request body sends it, with every \`date\`, \`time\` and \`decimal\` in the text the server parses. Returns a copy; \`value\` is not modified. */`;

    // A type-alias model has no fields: rewrite the aliased type as a whole.
    if (model.type) {
        const body = emit('__v', model.type, undefined, opts, scope);
        if (body.length === 0) return [];
        return [
            doc,
            `export function ${fnName}(value: ${paramType}): unknown {`,
            `    let __v: unknown = value;`,
            ...indent(body),
            `    return __v;`,
            `}`,
        ];
    }

    const obj = scope.next('o');
    const body = modelFieldStatements(model, obj, opts, scope);
    if (body.length === 0) return [];
    return [
        doc,
        `export function ${fnName}(value: ${paramType}): unknown {`,
        `    const ${obj} = { ...value } as Record<string, unknown>;`,
        ...indent(body),
        `    return ${obj};`,
        `}`,
    ];
}

/**
 * A standalone serializer for a request body that is not a plain model reference (an inline object,
 * a record, a tuple), where there is no `serializeX` to call. `null` when it has nothing to rewrite.
 */
export function renderInlineSerializer(fnName: string, tsType: string, type: ContractTypeNode, opts: SerializeCodegenOptions): string[] | null {
    const body = emit('__v', type, undefined, opts, new Scope());
    if (body.length === 0) return null;
    return [
        `/** One request body as it is sent, with every \`date\`, \`time\` and \`decimal\` in the text the server parses. Returns a copy. */`,
        `function ${fnName}(value: ${tsType}): unknown {`,
        `    let __v: unknown = value;`,
        ...indent(body),
        `    return __v;`,
        `}`,
    ];
}

/**
 * The models whose `serializeX` the emitted `lines` name, called or passed to `.map`. Only ever
 * given generated serializer code and call-site expressions, never a client class body, whose
 * method names could spell `serializeSomething(` too.
 */
export function calledSerializerModels(lines: string[], modelsWithSerializer: Set<string>): string[] {
    const found = new Set<string>();
    for (const m of lines.join('\n').matchAll(/(?<![A-Za-z0-9_$.])serialize([A-Za-z_$][A-Za-z0-9_$]*)(?=[()])/g)) {
        if (modelsWithSerializer.has(m[1]!)) found.add(m[1]!);
    }
    return [...found].sort();
}

/**
 * The type a request sends `name` as, which is what its serializer takes: its `XWireInput` where
 * `format(input=)` re-keys it, else its `XInput` where readonly fields split it, else itself. The
 * same choice `renderInputTsType` makes for the SDK method's parameter.
 */
export function requestTypeName(name: string, modelsWithInput?: Set<string>, modelsWithWireInput?: Set<string>): string {
    if (modelsWithWireInput?.has(name)) return `${name}WireInput`;
    return modelsWithInput?.has(name) ? `${name}Input` : name;
}

/**
 * Value imports for the serializers a types file's `bodyLines` call but do not declare.
 *
 * Read off the emitted text rather than the file's type references: a serializer walks the fields
 * a model inherits, so it can call the serializer of a model that only a base in another file
 * mentions, which the file imports nothing else from.
 */
export function serializerImportLines(
    bodyLines: string[],
    localNames: Set<string>,
    modelsWithSerializer: Set<string>,
    importPath: (model: string) => string,
): string[] {
    const byPath = new Map<string, string[]>();
    for (const model of calledSerializerModels(bodyLines, modelsWithSerializer)) {
        if (localNames.has(model)) continue;
        const path = importPath(model);
        byPath.set(path, [...(byPath.get(path) ?? []), serializeFnName(model)]);
    }
    return [...byPath].map(([path, names]) => `import { ${names.join(', ')} } from '${path}';`);
}
