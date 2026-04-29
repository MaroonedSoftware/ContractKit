import type {
    ContractRootNode,
    ModelNode,
    FieldNode,
    ContractTypeNode,
    ScalarTypeNode,
    ArrayTypeNode,
    TupleTypeNode,
    RecordTypeNode,
    EnumTypeNode,
    LiteralTypeNode,
    UnionTypeNode,
    ModelRefTypeNode,
    InlineObjectTypeNode,
    LazyTypeNode,
    SourceLocation,
    OpRootNode,
    OpRouteNode,
    OpOperationNode,
    OpParamNode,
    OpRequestNode,
    OpResponseNode,
    HttpMethod,
    ParamSource,
    RouteModifier,
} from '@contractkit/core';

// ─── AST Builder Helpers ────────────────────────────────────────────────────

export function loc(line = 1, file = 'test.ck'): SourceLocation {
    return { file, line };
}

export function scalarType(name: ScalarTypeNode['name'], mods?: Partial<ScalarTypeNode>): ScalarTypeNode {
    return { kind: 'scalar', name, ...mods };
}

export function arrayType(item: ContractTypeNode, mods?: { min?: number; max?: number }): ArrayTypeNode {
    return { kind: 'array', item, ...mods };
}

export function tupleType(...items: ContractTypeNode[]): TupleTypeNode {
    return { kind: 'tuple', items };
}

export function recordType(key: ContractTypeNode, value: ContractTypeNode): RecordTypeNode {
    return { kind: 'record', key, value };
}

export function enumType(...values: string[]): EnumTypeNode {
    return { kind: 'enum', values };
}

export function literalType(value: string | number | boolean): LiteralTypeNode {
    return { kind: 'literal', value };
}

export function unionType(...members: ContractTypeNode[]): UnionTypeNode {
    return { kind: 'union', members };
}

export function refType(name: string): ModelRefTypeNode {
    return { kind: 'ref', name };
}

export function inlineObjectType(fields: FieldNode[]): InlineObjectTypeNode {
    return { kind: 'inlineObject', fields };
}

export function lazyType(inner: ContractTypeNode): LazyTypeNode {
    return { kind: 'lazy', inner };
}

export function field(name: string, type: ContractTypeNode, overrides?: Partial<FieldNode>): FieldNode {
    return {
        name,
        optional: false,
        nullable: false,
        visibility: 'normal',
        type,
        loc: loc(),
        ...overrides,
    };
}

export function model(name: string, fields: FieldNode[], overrides?: Partial<ModelNode>): ModelNode {
    return {
        kind: 'model',
        name,
        fields,
        loc: loc(),
        ...overrides,
    };
}

export function contractRoot(models: ModelNode[], file = 'test.ck'): ContractRootNode {
    return { kind: 'contractRoot', meta: {}, models, file };
}

export function opParam(name: string, type: ContractTypeNode): OpParamNode {
    return { name, type, loc: loc(1, 'test.op') };
}

export function paramNodes(nodes: OpParamNode[]): ParamSource {
    return { kind: 'params', nodes };
}

export function paramRef(name: string): ParamSource {
    return { kind: 'ref', name };
}

export function paramType(node: ContractTypeNode): ParamSource {
    return { kind: 'type', node };
}

export function opRequest(
    bodyType: string | ContractTypeNode,
    contentType: 'application/json' | 'multipart/form-data' | 'application/x-www-form-urlencoded' = 'application/json',
): OpRequestNode {
    const bt: ContractTypeNode = typeof bodyType === 'string' ? refType(bodyType) : bodyType;
    return { bodies: [{ contentType, bodyType: bt }] };
}

export function opResponse(statusCode: number, bodyType?: string | ContractTypeNode, contentType?: 'application/json'): OpResponseNode {
    const bt: ContractTypeNode | undefined =
        bodyType === undefined ? undefined : typeof bodyType === 'string' ? parseBodyTypeString(bodyType) : bodyType;
    return { statusCode, contentType, bodyType: bt };
}

function parseBodyTypeString(s: string): ContractTypeNode {
    const arrayMatch = s.match(/^array\((.+)\)$/);
    if (arrayMatch?.[1]) {
        return { kind: 'array', item: refType(arrayMatch[1]) };
    }
    return refType(s);
}

/** Normalize a raw param value (old bare format or new discriminated union) to ParamSource. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParamSource(value: any): ParamSource {
    if (!value) return value;
    if (typeof value === 'string') return { kind: 'ref', name: value };
    if (Array.isArray(value)) return { kind: 'params', nodes: value };
    if (value.kind === 'params' || value.kind === 'ref' || value.kind === 'type') return value as ParamSource;
    return { kind: 'type', node: value as ContractTypeNode };
}

export function opOperation(method: HttpMethod, overrides?: Partial<OpOperationNode> & { query?: unknown; headers?: unknown }): OpOperationNode {
    const normalized = { ...overrides } as Partial<OpOperationNode>;
    if (overrides?.query !== undefined) normalized.query = normalizeParamSource(overrides.query);
    if (overrides?.headers !== undefined) normalized.headers = normalizeParamSource(overrides.headers);
    return {
        method,
        responses: [],
        loc: loc(1, 'test.op'),
        ...normalized,
    };
}

export function opRoute(
    path: string,
    operations: OpOperationNode[],
    params?: ParamSource | OpParamNode[] | string,
    modifiers?: RouteModifier[],
): OpRouteNode {
    const normalizedParams = params !== undefined ? normalizeParamSource(params) : undefined;
    return { path, params: normalizedParams, operations, modifiers, loc: loc(1, 'test.op') };
}

export function opRoot(routes: OpRouteNode[], file = 'users.op', meta: Record<string, string> = {}): OpRootNode {
    return { kind: 'opRoot', meta, routes, file };
}
