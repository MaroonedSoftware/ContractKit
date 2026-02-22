// ─── Shared ────────────────────────────────────────────────────────────────

export interface SourceLocation {
  file: string;
  line: number;
}

// ─── Contracts AST (.dto) ──────────────────────────────────────────────────

export type DtoTypeNode =
  | ScalarTypeNode
  | ArrayTypeNode
  | TupleTypeNode
  | RecordTypeNode
  | EnumTypeNode
  | LiteralTypeNode
  | UnionTypeNode
  | ModelRefTypeNode
  | InlineObjectTypeNode
  | LazyTypeNode;

export interface ScalarTypeNode {
  kind: 'scalar';
  name:
    | 'string' | 'number' | 'int' | 'bigint' | 'boolean'
    | 'date' | 'datetime' | 'email' | 'url' | 'uuid'
    | 'any' | 'unknown' | 'null' | 'object' | 'binary';
  min?: number | bigint;
  max?: number | bigint;
  len?: number;
  regex?: string;
}

export interface ArrayTypeNode {
  kind: 'array';
  item: DtoTypeNode;
  min?: number;
  max?: number;
}

export interface TupleTypeNode {
  kind: 'tuple';
  items: DtoTypeNode[];
}

export interface RecordTypeNode {
  kind: 'record';
  key: DtoTypeNode;
  value: DtoTypeNode;
}

export interface EnumTypeNode {
  kind: 'enum';
  values: string[];
}

export interface LiteralTypeNode {
  kind: 'literal';
  value: string | number | boolean;
}

export interface UnionTypeNode {
  kind: 'union';
  members: DtoTypeNode[];
}

export interface ModelRefTypeNode {
  kind: 'ref';
  name: string;
  lazy?: boolean;
}

export interface InlineObjectTypeNode {
  kind: 'inlineObject';
  fields: FieldNode[];
}

export interface LazyTypeNode {
  kind: 'lazy';
  inner: DtoTypeNode;
}

export interface FieldNode {
  name: string;
  optional: boolean;
  nullable: boolean;
  visibility: 'readonly' | 'writeonly' | 'normal';
  type: DtoTypeNode;
  default?: string | number | boolean;
  description?: string;
  loc: SourceLocation;
}

export interface ModelNode {
  kind: 'model';
  name: string;
  base?: string;
  fields: FieldNode[];
  description?: string;
  loc: SourceLocation;
}

export interface DtoRootNode {
  kind: 'dtoRoot';
  models: ModelNode[];
  file: string;
}

// ─── Operations AST (.op) ──────────────────────────────────────────────────

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpParamNode {
  name: string;
  type: DtoTypeNode;
  loc: SourceLocation;
}

export interface OpRequestNode {
  contentType: 'application/json' | 'multipart/form-data';
  bodyType: string; // model name or inline type string
}

export interface OpResponseNode {
  statusCode: number;
  contentType?: 'application/json';
  bodyType?: string; // model name or inline type string (e.g. array(X))
}

export interface OpOperationNode {
  method: HttpMethod;
  service?: string; // e.g. "LedgerService.updateCategoryNesting"
  request?: OpRequestNode;
  response?: OpResponseNode;
  query?: OpParamNode[];
  headers?: OpParamNode[];
  loc: SourceLocation;
}

export interface OpRouteNode {
  path: string;
  params?: OpParamNode[];
  operations: OpOperationNode[];
  loc: SourceLocation;
}

export interface OpRootNode {
  kind: 'opRoot';
  routes: OpRouteNode[];
  file: string;
}
