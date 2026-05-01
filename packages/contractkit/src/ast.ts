// ─── Shared ────────────────────────────────────────────────────────────────

export interface SourceLocation {
    file: string;
    line: number;
}

export const SCALAR_NAMES: ReadonlySet<string> = new Set<ScalarTypeNode['name']>([
    'string',
    'number',
    'int',
    'bigint',
    'boolean',
    'date',
    'time',
    'datetime',
    'duration',
    'interval',
    'email',
    'url',
    'uuid',
    'unknown',
    'null',
    'object',
    'binary',
    'json',
]);

// ─── Contracts AST (.ck) ──────────────────────────────────────────────────

export type ContractTypeNode =
    | ScalarTypeNode
    | ArrayTypeNode
    | TupleTypeNode
    | RecordTypeNode
    | EnumTypeNode
    | LiteralTypeNode
    | UnionTypeNode
    | DiscriminatedUnionTypeNode
    | IntersectionTypeNode
    | ModelRefTypeNode
    | InlineObjectTypeNode
    | LazyTypeNode;

export interface ScalarTypeNode {
    kind: 'scalar';
    name:
        | 'string'
        | 'number'
        | 'int'
        | 'bigint'
        | 'boolean'
        | 'date'
        | 'time'
        | 'datetime'
        | 'duration'
        | 'interval'
        | 'email'
        | 'url'
        | 'uuid'
        | 'unknown'
        | 'null'
        | 'object'
        | 'binary'
        | 'json';
    min?: number | bigint | string;
    max?: number | bigint | string;
    len?: number;
    regex?: string;
    format?: string;
}

export interface ArrayTypeNode {
    kind: 'array';
    item: ContractTypeNode;
    min?: number;
    max?: number;
}

export interface TupleTypeNode {
    kind: 'tuple';
    items: ContractTypeNode[];
}

export interface RecordTypeNode {
    kind: 'record';
    key: ContractTypeNode;
    value: ContractTypeNode;
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
    members: ContractTypeNode[];
}

export interface DiscriminatedUnionTypeNode {
    kind: 'discriminatedUnion';
    discriminator: string;
    members: ContractTypeNode[];
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
    members: ContractTypeNode[];
}

export interface LazyTypeNode {
    kind: 'lazy';
    inner: ContractTypeNode;
}

export interface FieldNode {
    name: string;
    optional: boolean;
    nullable: boolean;
    visibility: 'readonly' | 'writeonly' | 'normal';
    type: ContractTypeNode;
    default?: string | number | boolean;
    deprecated?: boolean;
    /** Set when the field is declared with the `override` modifier — used by inheritance validation
     * to confirm the field is intentionally redeclaring a conflicting base field. */
    override?: boolean;
    description?: string;
    loc: SourceLocation;
}

export interface ModelNode {
    kind: 'model';
    name: string;
    /** Names of base contracts this model extends, in left-to-right declaration order.
     * `contract C: A & B & { ... }` produces `bases: ['A', 'B']`. Empty/undefined for non-inherited models. */
    bases?: string[];
    fields: FieldNode[];
    type?: ContractTypeNode; // type alias: Name: typeExpression (fields will be empty)
    mode?: ObjectMode; // object validation mode — defaults to 'strict'
    inputCase?: 'camel' | 'snake' | 'pascal'; // format(input=) — key casing of incoming data
    outputCase?: 'camel' | 'snake' | 'pascal'; // format(output=) — key casing of emitted data
    deprecated?: boolean;
    description?: string;
    loc: SourceLocation;
}

export interface ContractRootNode {
    kind: 'contractRoot';
    meta: Record<string, string>;
    /** Service name → module path mappings from `options { services { ... } }`. */
    services?: Record<string, string>;
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
    optional: boolean;
    nullable: boolean;
    type: ContractTypeNode;
    default?: string | number | boolean;
    description?: string;
    loc: SourceLocation;
}

/** Either inline param declarations, a single type reference name, or a ContractTypeNode. */
export type ParamSource = { kind: 'params'; nodes: OpParamNode[] } | { kind: 'ref'; name: string } | { kind: 'type'; node: ContractTypeNode };

/**
 * Recognized request mime types that codegen has dedicated handling for. Other strings are
 * still permitted (any RFC 6838-shaped `type/subtype`) and pass through unchanged; codegen
 * falls back to a JSON-ish default for `+json` suffixes and a generic body for everything else.
 */
export type KnownRequestContentType = 'application/json' | 'multipart/form-data' | 'application/x-www-form-urlencoded';

export interface OpRequestBodyNode {
    contentType: string;
    bodyType: ContractTypeNode;
}

export interface OpRequestNode {
    bodies: OpRequestBodyNode[];
}

export interface OpResponseHeaderNode {
    /** Header name as written in the .ck source (preserves casing/hyphens, e.g. `preference-applied`, `ETag`). */
    name: string;
    optional: boolean;
    type: ContractTypeNode;
    description?: string;
}

export interface OpResponseNode {
    statusCode: number;
    contentType?: string;
    bodyType?: ContractTypeNode;
    /** Declared response headers for this status code. Undefined = none declared. */
    headers?: OpResponseHeaderNode[];
    /** Set when the status code body declares `headers: none` — suppresses options-level response header merge for this code. */
    headersOptOut?: boolean;
}

export interface OpOperationNode {
    method: HttpMethod;
    name?: string; // e.g. "Create an Offer" — human-readable name for docs/collections
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
    /** Set when the operation declares `headers: none` — suppresses options-level request header merge for this op. */
    requestHeadersOptOut?: boolean;
    security?: SecurityNode; // overrides config default; "none" = explicitly public
    /** Explicit modifiers. undefined = inherit from route; [] or array = override. */
    modifiers?: RouteModifier[];
    /** Raw plugin values from the grammar, e.g. `{ bruno: "request-token.yml" }`. */
    plugins?: Record<string, string>;
    /** Resolved plugin file contents keyed by plugin name. Populated by the CLI resolver; never set by the parser. */
    pluginFiles?: Record<string, string>;
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
    /** Service name → module path mappings from `options { services { ... } }`. */
    services?: Record<string, string>;
    /** File-level security default — cascades to all routes/operations unless overridden. */
    security?: SecurityNode;
    /** File-level request headers from `options { request: { headers { ... } } }` — merged into every operation's request headers. */
    requestHeaders?: OpResponseHeaderNode[];
    /** File-level response headers from `options { response: { headers { ... } } }` — merged into every status code on every operation. */
    responseHeaders?: OpResponseHeaderNode[];
    routes: OpRouteNode[];
    file: string;
    /** Comment lines not attached to any node, sorted by line number. */
    orphanComments?: Array<{ line: number; text: string }>;
}

// ─── Unified AST (.ck) ───────────────────────────────────────────────────

export interface CkRootNode {
    kind: 'ckRoot';
    meta: Record<string, string>;
    services: Record<string, string>;
    /** File-level security default — cascades to all routes/operations unless overridden. */
    security?: SecurityNode;
    /** File-level request headers from `options { request: { headers { ... } } }` — merged into every operation's request headers. */
    requestHeaders?: OpResponseHeaderNode[];
    /** File-level response headers from `options { response: { headers { ... } } }` — merged into every status code on every operation. */
    responseHeaders?: OpResponseHeaderNode[];
    models: ModelNode[];
    routes: OpRouteNode[];
    file: string;
}
