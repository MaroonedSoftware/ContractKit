import type {
  CkRootNode,
  ModelNode,
  FieldNode,
  DtoTypeNode,
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

export function arrayType(item: DtoTypeNode, mods?: { min?: number; max?: number }): ArrayTypeNode {
  return { kind: 'array', item, ...mods };
}

export function tupleType(...items: DtoTypeNode[]): TupleTypeNode {
  return { kind: 'tuple', items };
}

export function recordType(key: DtoTypeNode, value: DtoTypeNode): RecordTypeNode {
  return { kind: 'record', key, value };
}

export function enumType(...values: string[]): EnumTypeNode {
  return { kind: 'enum', values };
}

export function literalType(value: string | number | boolean): LiteralTypeNode {
  return { kind: 'literal', value };
}

export function unionType(...members: DtoTypeNode[]): UnionTypeNode {
  return { kind: 'union', members };
}

export function intersectionType(...members: DtoTypeNode[]): IntersectionTypeNode {
  return { kind: 'intersection', members };
}

export function refType(name: string): ModelRefTypeNode {
  return { kind: 'ref', name };
}

export function inlineObjectType(fields: FieldNode[]): InlineObjectTypeNode {
  return { kind: 'inlineObject', fields };
}

export function lazyType(inner: DtoTypeNode): LazyTypeNode {
  return { kind: 'lazy', inner };
}

export function field(name: string, type: DtoTypeNode, overrides?: Partial<FieldNode>): FieldNode {
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

export function ckRoot(
  overrides?: Partial<CkRootNode>,
): CkRootNode {
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

export function opParam(name: string, type: DtoTypeNode, overrides?: Partial<OpParamNode>): OpParamNode {
  return { name, optional: false, nullable: false, type, loc: loc(), ...overrides };
}

export function opRequest(bodyType: DtoTypeNode, contentType: string = 'application/json'): OpRequestNode {
  return { contentType: contentType as OpRequestNode['contentType'], bodyType };
}

export function opResponse(statusCode: number, bodyType?: DtoTypeNode, contentType?: 'application/json'): OpResponseNode {
  return { statusCode, contentType, bodyType };
}

export function opOperation(method: HttpMethod, overrides?: Partial<OpOperationNode>): OpOperationNode {
  return {
    method,
    responses: [],
    loc: loc(),
    ...overrides,
  };
}

export function opRoute(path: string, operations: OpOperationNode[], overrides?: Partial<OpRouteNode>): OpRouteNode {
  return { path, operations, loc: loc(), ...overrides };
}
