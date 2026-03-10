// ─── Shared ────────────────────────────────────────────────────────────────

export interface SourceLocation {
  file: string;
  line: number;
}

export const SCALAR_NAMES: ReadonlySet<string> = new Set<ScalarTypeNode['name']>([
  'string', 'number', 'int', 'bigint', 'boolean',
  'date', 'datetime', 'email', 'url', 'uuid',
  'any', 'unknown', 'null', 'object', 'binary',
]);

// ─── Contracts AST (.dto) ──────────────────────────────────────────────────

export type DtoTypeNode =
  | ScalarTypeNode
  | ArrayTypeNode
  | TupleTypeNode
  | RecordTypeNode
  | EnumTypeNode
  | LiteralTypeNode
  | UnionTypeNode
  | IntersectionTypeNode
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

export interface IntersectionTypeNode {
  kind: 'intersection';
  members: DtoTypeNode[];
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
  type?: DtoTypeNode; // type alias: Name: typeExpression (fields will be empty)
  description?: string;
  loc: SourceLocation;
}

export interface DtoRootNode {
  kind: 'dtoRoot';
  meta: Record<string, string>;
  models: ModelNode[];
  file: string;
  /** Comment lines not attached to any node, sorted by line number. */
  orphanComments?: Array<{ line: number; text: string }>;
}

// ─── Operations AST (.op) ──────────────────────────────────────────────────

export interface SecuritySchemeNode {
  name: string;                                       // "bearer", "apiKey", "none", or custom
  params: Record<string, string | number | boolean>;  // e.g. { header: "X-API-Key" }
  scopes: string[];                                   // e.g. ["read:users", "write:users"]
}

/** Array of alternative schemes — any one satisfies the security requirement. */
export type SecurityNode = SecuritySchemeNode[];

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpParamNode {
  name: string;
  type: DtoTypeNode;
  description?: string;
  loc: SourceLocation;
}

/** Either inline param declarations, a single type reference name, or a DtoTypeNode. */
export type ParamSource = OpParamNode[] | string | DtoTypeNode;

export interface OpRequestNode {
  contentType: 'application/json' | 'multipart/form-data';
  bodyType: DtoTypeNode;
}

export interface OpResponseNode {
  statusCode: number;
  contentType?: 'application/json';
  bodyType?: DtoTypeNode;
}

export interface OpOperationNode {
  method: HttpMethod;
  service?: string; // e.g. "LedgerService.updateCategoryNesting"
  sdk?: string; // e.g. "getUser" — explicit SDK method name
  request?: OpRequestNode;
  responses: OpResponseNode[];
  query?: ParamSource;
  headers?: ParamSource;
  security?: SecurityNode; // overrides config default; "none" = explicitly public
  description?: string;
  loc: SourceLocation;
}

export interface OpRouteNode {
  path: string;
  params?: ParamSource;
  operations: OpOperationNode[];
  description?: string;
  loc: SourceLocation;
}

export interface OpRootNode {
  kind: 'opRoot';
  meta: Record<string, string>;
  routes: OpRouteNode[];
  file: string;
  /** Comment lines not attached to any node, sorted by line number. */
  orphanComments?: Array<{ line: number; text: string }>;
}
