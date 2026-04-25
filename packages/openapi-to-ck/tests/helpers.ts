import type {
    CkRootNode,
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
    IntersectionTypeNode,
    ModelRefTypeNode,
    InlineObjectTypeNode,
    LazyTypeNode,
    SourceLocation,
    OpRouteNode,
    OpOperationNode,
    OpParamNode,
    OpRequestNode,
    OpResponseNode,
    HttpMethod,
    ParamSource,
    RouteModifier,
    SecurityNode,
} from '@maroonedsoftware/contractkit';

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

export function intersectionType(...members: ContractTypeNode[]): IntersectionTypeNode {
    return { kind: 'intersection', members };
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

export function ckRoot(overrides?: Partial<CkRootNode>): CkRootNode {
    return {
        kind: 'ckRoot',
        meta: {},
        services: {},
        models: [],
        routes: [],
        file: 'test.ck',
        ...overrides,
    };
}

export function opParam(name: string, type: ContractTypeNode, overrides?: Partial<OpParamNode>): OpParamNode {
    return { name, optional: false, nullable: false, type, loc: loc(), ...overrides };
}

export function opRequest(bodyType: ContractTypeNode, contentType: string = 'application/json'): OpRequestNode {
    return {
        bodies: [
            {
                contentType: contentType as OpRequestNode['bodies'][number]['contentType'],
                bodyType,
            },
        ],
    };
}

export function opResponse(statusCode: number, bodyType?: ContractTypeNode, contentType?: 'application/json'): OpResponseNode {
    return { statusCode, contentType, bodyType };
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
        loc: loc(),
        ...normalized,
    };
}

export function opRoute(path: string, operations: OpOperationNode[], overrides?: Partial<OpRouteNode> & { params?: unknown }): OpRouteNode {
    const normalized = { ...overrides } as Partial<OpRouteNode>;
    if (overrides?.params !== undefined) normalized.params = normalizeParamSource(overrides.params);
    return { path, operations, loc: loc(), ...normalized };
}
