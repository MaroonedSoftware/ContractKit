import type {
  DtoRootNode, ModelNode, FieldNode, DtoTypeNode,
  ScalarTypeNode, ArrayTypeNode, TupleTypeNode, RecordTypeNode,
  EnumTypeNode, LiteralTypeNode, UnionTypeNode, ModelRefTypeNode,
  InlineObjectTypeNode, LazyTypeNode, SourceLocation,
  OpRootNode, OpRouteNode, OpOperationNode, OpParamNode,
  OpRequestNode, OpResponseNode, HttpMethod, ParamSource,
} from '../src/ast.js';

// ─── AST Builder Helpers ────────────────────────────────────────────────────

export function loc(line = 1, file = 'test.dto'): SourceLocation {
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

export function dtoRoot(models: ModelNode[], file = 'test.dto'): DtoRootNode {
  return { kind: 'dtoRoot', models, file };
}

export function opParam(name: string, type: DtoTypeNode): OpParamNode {
  return { name, type, loc: loc(1, 'test.op') };
}

export function opRequest(bodyType: string | DtoTypeNode, contentType: OpRequestNode['contentType'] = 'application/json'): OpRequestNode {
  const bt: DtoTypeNode = typeof bodyType === 'string' ? refType(bodyType) : bodyType;
  return { contentType, bodyType: bt };
}

export function opResponse(statusCode: number, bodyType?: string | DtoTypeNode, contentType?: 'application/json'): OpResponseNode {
  const bt: DtoTypeNode | undefined = bodyType === undefined ? undefined
    : typeof bodyType === 'string' ? parseBodyTypeString(bodyType) : bodyType;
  return { statusCode, contentType, bodyType: bt };
}

function parseBodyTypeString(s: string): DtoTypeNode {
  const arrayMatch = s.match(/^array\((.+)\)$/);
  if (arrayMatch?.[1]) {
    return { kind: 'array', item: refType(arrayMatch[1]) };
  }
  return refType(s);
}

export function opOperation(method: HttpMethod, overrides?: Partial<OpOperationNode>): OpOperationNode {
  return {
    method,
    responses: [],
    loc: loc(1, 'test.op'),
    ...overrides,
  };
}

export function opRoute(path: string, operations: OpOperationNode[], params?: ParamSource): OpRouteNode {
  return { path, params, operations, loc: loc(1, 'test.op') };
}

export function opRoot(routes: OpRouteNode[], file = 'users.op'): OpRootNode {
  return { kind: 'opRoot', routes, file };
}

// ─── DSL Fixture Strings ────────────────────────────────────────────────────

export const SIMPLE_USER_DTO = `\
User: {
    id: readonly uuid
    name: string
    email: email
    age?: number
    active: boolean = true
}
`;

export const VISIBILITY_DTO = `\
User: {
    id: readonly uuid
    name: string
    password: writeonly string
}
`;

export const INHERITANCE_DTO = `\
Admin: User {
    role: enum(admin, superadmin)
}
`;

export const SIMPLE_USERS_OP = `\
/users {
    get: {
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
    post: {
        request: {
            application/json: CreateUserInput
        }
        response: {
            201: {
                application/json: User
            }
        }
    }
}
`;

export const PARAMETERIZED_OP = `\
/users/:id {
    params: {
        id: uuid
    }
    get: {
        response: {
            200: {
                application/json: User
            }
        }
    }
    delete: {}
}
`;
