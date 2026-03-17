// ─── Shared ────────────────────────────────────────────────────────────────

export interface SourceLocation {
  file: string;
  line: number;
}

export const SCALAR_NAMES: ReadonlySet<string> = new Set<ScalarTypeNode['name']>([
  'string', 'number', 'int', 'bigint', 'boolean',
  'date', 'time', 'datetime', 'email', 'url', 'uuid',
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
    | 'date' | 'time' | 'datetime' | 'email' | 'url' | 'uuid'
    | 'any' | 'unknown' | 'null' | 'object' | 'binary';
  min?: number | bigint;
  max?: number | bigint;
  len?: number;
  regex?: string;
  format?: string;
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
  mode?: ObjectMode;
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
  mode?: ObjectMode;  // object validation mode — defaults to 'strict'
  camelCase?: boolean; // keys are defined in camelCase but parsed from snake_case input
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

/** Constrained security declaration — roles-only auth fields. */
export interface SecurityFields {
  /** Allowlisted role names required for this endpoint (e.g. `["admin", "moderator"]`). */
  roles?: string[];
  /** Inline comment attached to the `roles:` line. */
  rolesDescription?: string;
  loc: SourceLocation;
}

/** Sentinel value for explicitly public endpoints (`security: none`). */
export const SECURITY_NONE = 'none' as const;
export type SecurityNone = typeof SECURITY_NONE;

/** Security declaration: explicit public (`none`), or constrained auth fields. */
export type SecurityNode = SecurityNone | SecurityFields;

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Controls how Zod handles unknown keys on an object schema. */
export type ObjectMode = 'strict' | 'strip' | 'loose';

/** Visibility/lifecycle modifiers on routes and operations.
 * `public` is operation-only: overrides inherited route-level modifiers. */
export type RouteModifier = 'internal' | 'deprecated' | 'public';

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
  /** HMAC signature key name for this endpoint (e.g. `WEBHOOK_SECRET`). */
  signature?: string;
  /** Inline comment attached to the `signature:` line. */
  signatureDescription?: string;
  request?: OpRequestNode;
  responses: OpResponseNode[];
  query?: ParamSource;
  queryMode?: ObjectMode;
  headers?: ParamSource;
  headersMode?: ObjectMode;
  security?: SecurityNode; // overrides config default; "none" = explicitly public
  /** Explicit modifiers. undefined = inherit from route; [] or array = override. */
  modifiers?: RouteModifier[];
  description?: string;
  loc: SourceLocation;
}

export interface OpRouteNode {
  path: string;
  params?: ParamSource;
  paramsMode?: ObjectMode;
  operations: OpOperationNode[];
  /** Route-level modifiers — cascade to all operations unless overridden. */
  modifiers?: RouteModifier[];
  /** Route-level security default — cascades to operations that have no explicit security declaration. */
  security?: SecurityNode;
  description?: string;
  loc: SourceLocation;
}

/**
 * Resolves the effective modifiers for an operation, applying route-level cascade.
 * If the operation specifies any explicit modifiers, those replace (not merge) the route's.
 * `public` on an operation acts as an explicit override that clears inherited modifiers;
 * it is stripped from the returned array (it is not a codegen modifier itself).
 */
export function resolveModifiers(route: OpRouteNode, op: OpOperationNode): RouteModifier[] {
  const raw = op.modifiers ?? route.modifiers ?? [];
  return raw.filter(m => m !== 'public');
}

/**
 * Resolves the effective security for an operation, applying cascade from operation → route → file.
 * Operation-level security always wins; if absent, the route's security is used; if absent, the file's.
 */
export function resolveSecurity(route: OpRouteNode, op: OpOperationNode, root?: OpRootNode): SecurityNode | undefined {
  if (op.security !== undefined) return op.security;
  if (route.security !== undefined) return route.security;
  return root?.security;
}

export interface OpRootNode {
  kind: 'opRoot';
  meta: Record<string, string>;
  /** File-level security default — cascades to all routes/operations unless overridden. */
  security?: SecurityNode;
  routes: OpRouteNode[];
  file: string;
  /** Comment lines not attached to any node, sorted by line number. */
  orphanComments?: Array<{ line: number; text: string }>;
}
