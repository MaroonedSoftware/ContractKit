/**
 * Shared type-building utilities used by both contract and operation semantic actions.
 * Extracted from visitor-contract.ts and visitor-op.ts to eliminate duplication.
 */
import type { ContractTypeNode, ScalarTypeNode, UnionTypeNode } from './ast.js';
import { SCALAR_NAMES } from './ast.js';

export const OBJECT_MODES = new Set<string>(['strict', 'strip', 'loose']);
export const ROUTE_MODIFIERS = new Set<string>(['internal', 'deprecated', 'public']);
export const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete']);

/**
 * Parsed type argument — either a key=value constraint or a positional value.
 *
 * A number literal's `value` has already been through `Number()`, so `source` carries the digits as
 * written for the bounds that must not be rounded by a float (see `coerceBound`).
 */
export type TypeArgKeyValue = { key: string; value: string | number | boolean; source?: string };
export type TypeArgString = { type: 'string'; value: string };
export type TypeArgNumber = { type: 'number'; value: number };
export type TypeArgBoolean = { type: 'boolean'; value: boolean };
export type TypeArgType = { type: 'type'; value: ContractTypeNode };
export type TypeArg = TypeArgKeyValue | TypeArgString | TypeArgNumber | TypeArgBoolean | TypeArgType;

/** Resolve a simple type name to a ContractTypeNode (scalar or model ref). */
export function resolveSimpleType(name: string): ContractTypeNode {
    if (SCALAR_NAMES.has(name)) {
        return { kind: 'scalar', name: name as ScalarTypeNode['name'] };
    }
    return { kind: 'ref', name };
}

/**
 * Build a compound or constrained type from a type name and parsed arguments.
 *
 * `report` receives an argument the type cannot represent, such as a non-integer `bigint` bound;
 * the argument is dropped rather than failing the whole parse.
 */
export function buildCompoundType(name: string, args: TypeArg[], report?: (message: string) => void): ContractTypeNode {
    switch (name) {
        case 'array':
            return buildArrayType(args);
        case 'tuple':
            return buildTupleType(args);
        case 'record':
            return buildRecordType(args);
        case 'enum':
            return buildEnumType(args);
        case 'literal':
            return buildLiteralType(args);
        case 'lazy':
            return buildLazyType(args);
        case 'discriminated':
            return buildDiscriminatedUnionType(args);
        default: {
            if (SCALAR_NAMES.has(name)) {
                return buildScalarWithModifiers(name as ScalarTypeNode['name'], args, report);
            }
            return { kind: 'ref', name };
        }
    }
}

function buildArrayType(args: TypeArg[]): ContractTypeNode {
    const typeArgs = args.filter((a): a is TypeArgType => 'type' in a && a.type === 'type');
    const item: ContractTypeNode = typeArgs[0]?.value ?? { kind: 'scalar', name: 'unknown' };
    let min: number | undefined;
    let max: number | undefined;
    for (const a of args) {
        if ('key' in a && a.key === 'min') min = Number(a.value);
        if ('key' in a && a.key === 'max') max = Number(a.value);
    }
    return { kind: 'array', item, min, max };
}

function buildTupleType(args: TypeArg[]): ContractTypeNode {
    const items = args.filter((a): a is TypeArgType => 'type' in a && a.type === 'type').map(a => a.value);
    return { kind: 'tuple', items };
}

function buildRecordType(args: TypeArg[]): ContractTypeNode {
    const typeArgs = args.filter((a): a is TypeArgType => 'type' in a && a.type === 'type');
    const key: ContractTypeNode = typeArgs[0]?.value ?? { kind: 'scalar', name: 'string' };
    const value: ContractTypeNode = typeArgs[1]?.value ?? { kind: 'scalar', name: 'unknown' };
    return { kind: 'record', key, value };
}

function buildEnumType(args: TypeArg[]): ContractTypeNode {
    const values: string[] = [];
    for (const a of args) {
        if ('type' in a && a.type === 'type' && a.value.kind === 'ref') {
            values.push(a.value.name);
        } else if ('type' in a && a.type === 'string') {
            values.push(a.value);
        } else if ('type' in a && a.type === 'type' && a.value.kind === 'scalar') {
            values.push(a.value.name);
        }
    }
    return { kind: 'enum', values };
}

function buildLiteralType(args: TypeArg[]): ContractTypeNode {
    const arg = args[0];
    if (!arg) return { kind: 'literal', value: '' };
    if ('type' in arg) {
        if (arg.type === 'string') return { kind: 'literal', value: arg.value };
        if (arg.type === 'number') return { kind: 'literal', value: arg.value };
        if (arg.type === 'boolean') return { kind: 'literal', value: arg.value };
    }
    return { kind: 'literal', value: String('value' in arg ? arg.value : '') };
}

function buildLazyType(args: TypeArg[]): ContractTypeNode {
    const typeArg = args.find((a): a is TypeArgType => 'type' in a && a.type === 'type');
    const inner: ContractTypeNode = typeArg?.value ?? { kind: 'scalar', name: 'unknown' };
    return { kind: 'lazy', inner };
}

function buildDiscriminatedUnionType(args: TypeArg[]): ContractTypeNode {
    let discriminator = '';
    for (const a of args) {
        if ('key' in a && a.key === 'by') {
            discriminator = String(a.value);
        }
    }

    const typeArgs = args.filter((a): a is TypeArgType => 'type' in a && a.type === 'type');
    const members: ContractTypeNode[] = [];
    for (const ta of typeArgs) {
        // A single TypeExpression like `A | B | C` arrives as one TypeArgType with a union node.
        // Flatten it so members ends up as the leaf types.
        if (ta.value.kind === 'union') {
            members.push(...ta.value.members);
        } else {
            members.push(ta.value);
        }
    }

    return { kind: 'discriminatedUnion', discriminator, members };
}

function isKeyValue(arg: TypeArg): arg is TypeArgKeyValue {
    return 'key' in arg;
}

/** An integer as `.ck` source spells it, and as `BigInt()` accepts it. */
const INTEGER_LITERAL = /^-?\d+$/;

/**
 * Coerce a `min=`/`max=` type argument to the representation its scalar compares against.
 *
 * `bigint` and `decimal` both carry values a JS number cannot hold exactly: `bigint` has its own
 * primitive, and `decimal` keeps the source text for decimal.js to parse. Both read the literal as
 * written rather than `arg.value`, which the semantics have already turned into a float, so
 * `max=9007199254740993` would otherwise arrive as `9007199254740992`. Everything else is a float.
 *
 * Returns `undefined`, after reporting it, for a `bigint` bound that is not an integer.
 */
function coerceBound(name: ScalarTypeNode['name'], arg: TypeArgKeyValue, report?: (message: string) => void): number | bigint | string | undefined {
    const text = arg.source ?? String(arg.value);
    if (name === 'bigint') {
        if (INTEGER_LITERAL.test(text)) return BigInt(text);
        report?.(`bigint ${arg.key} must be an integer, got ${text}`);
        return undefined;
    }
    if (name === 'duration' || name === 'decimal') return text;
    return Number(arg.value);
}

function buildScalarWithModifiers(name: ScalarTypeNode['name'], args: TypeArg[], report?: (message: string) => void): ScalarTypeNode {
    const scalar: ScalarTypeNode = { kind: 'scalar', name };
    for (const a of args) {
        // Positional string argument (quoted): used as format for date/time types
        if ('type' in a && a.type === 'string' && !('key' in a)) {
            if (name === 'date' || name === 'time' || name === 'datetime') {
                scalar.format = String(a.value);
            }
            continue;
        }
        // Positional ref argument (unquoted identifier): used as format for date/time types
        if ('type' in a && a.type === 'type' && a.value?.kind === 'ref' && !('key' in a)) {
            if (name === 'date' || name === 'time' || name === 'datetime') {
                scalar.format = String(a.value.name);
            }
            continue;
        }
        if (!isKeyValue(a)) continue;
        // `decimal` bounds stay strings for the same reason the scalar exists: routing `0.01`
        // through `Number()` would round-trip it via a float before the bound is ever compared.
        if (a.key === 'min') scalar.min = coerceBound(name, a, report);
        if (a.key === 'max') scalar.max = coerceBound(name, a, report);
        if (a.key === 'len' || a.key === 'length') scalar.len = Number(a.value);
        if (a.key === 'scale') scalar.scale = Number(a.value);
        if (a.key === 'regex') scalar.regex = String(a.value);
        if (a.key === 'format') scalar.format = String(a.value);
    }
    return scalar;
}

/**
 * Extract nullability from a type node.
 * If the type is a union containing `null`, remove the null member and return nullable=true.
 */
export function extractNullability(type: ContractTypeNode): { type: ContractTypeNode; nullable: boolean } {
    if (type.kind === 'union') {
        const union = type as UnionTypeNode;
        const nullIdx = union.members.findIndex(m => m.kind === 'scalar' && (m as ScalarTypeNode).name === 'null');
        if (nullIdx !== -1) {
            const filtered = [...union.members];
            filtered.splice(nullIdx, 1);
            return { type: filtered.length === 1 ? filtered[0]! : { kind: 'union', members: filtered }, nullable: true };
        }
    } else if (type.kind === 'scalar' && type.name === 'null') {
        return { type, nullable: true };
    }
    return { type, nullable: false };
}

/**
 * Convert a ContractTypeNode to ParamSource for query/headers blocks.
 */
export function typeNodeToParamSource(node: ContractTypeNode): import('./ast.js').ParamSource {
    if (node.kind === 'ref') return { kind: 'ref', name: node.name };
    if (node.kind === 'inlineObject') {
        return {
            kind: 'params',
            nodes: node.fields.map(f => ({
                name: f.name,
                optional: f.optional,
                nullable: f.nullable,
                type: f.type,
                default: f.default,
                description: f.description,
                loc: f.loc,
            })),
        };
    }
    return { kind: 'type', node: node };
}
