import type {
    ContractRootNode,
    ModelNode,
    FieldNode,
    ContractTypeNode,
    ScalarTypeNode,
    ArrayTypeNode,
    EnumTypeNode,
    ModelRefTypeNode,
    InlineObjectTypeNode,
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
} from '@maroonedsoftware/contractkit';

export function loc(line = 1, file = 'test.dto'): SourceLocation {
    return { file, line };
}

export function scalarType(name: ScalarTypeNode['name'], mods?: Partial<ScalarTypeNode>): ScalarTypeNode {
    return { kind: 'scalar', name, ...mods };
}

export function arrayType(item: ContractTypeNode): ArrayTypeNode {
    return { kind: 'array', item };
}

export function enumType(...values: string[]): EnumTypeNode {
    return { kind: 'enum', values };
}

export function refType(name: string): ModelRefTypeNode {
    return { kind: 'ref', name };
}

export function inlineObjectType(fields: FieldNode[]): InlineObjectTypeNode {
    return { kind: 'inlineObject', fields };
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
    return { kind: 'model', name, fields, loc: loc(), ...overrides };
}

export function contractRoot(models: ModelNode[], file = 'test.dto'): ContractRootNode {
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

export function opRequest(bodyType: string | ContractTypeNode, contentType: OpRequestNode['contentType'] = 'application/json'): OpRequestNode {
    const bt: ContractTypeNode = typeof bodyType === 'string' ? refType(bodyType) : bodyType;
    return { contentType, bodyType: bt };
}

export function opResponse(statusCode: number, bodyType?: string | ContractTypeNode, contentType?: 'application/json'): OpResponseNode {
    const bt = bodyType === undefined ? undefined : typeof bodyType === 'string' ? refType(bodyType) : bodyType;
    return { statusCode, contentType, bodyType: bt };
}

export function opOperation(method: HttpMethod, overrides?: Partial<OpOperationNode> & { query?: unknown; headers?: unknown }): OpOperationNode {
    const normalized = { ...overrides } as Partial<OpOperationNode>;
    if (overrides?.query !== undefined) {
        const q = overrides.query as any;
        normalized.query = Array.isArray(q) ? { kind: 'params', nodes: q } : q;
    }
    if (overrides?.headers !== undefined) {
        const h = overrides.headers as any;
        normalized.headers = Array.isArray(h) ? { kind: 'params', nodes: h } : h;
    }
    return { method, responses: [], loc: loc(1, 'test.op'), ...normalized };
}

export function opRoute(
    path: string,
    operations: OpOperationNode[],
    params?: ParamSource | OpParamNode[] | string,
    modifiers?: RouteModifier[],
): OpRouteNode {
    const normalizedParams = params === undefined ? undefined
        : typeof params === 'string' ? { kind: 'ref' as const, name: params }
        : Array.isArray(params) ? { kind: 'params' as const, nodes: params }
        : params;
    return { path, params: normalizedParams, operations, modifiers, loc: loc(1, 'test.op') };
}

export function opRoot(routes: OpRouteNode[], file = 'users.op', meta: Record<string, string> = {}): OpRootNode {
    return { kind: 'opRoot', meta, routes, file };
}
