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
    'decimal',
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
        | 'decimal'
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
    /**
     * `decimal` only: the maximum number of decimal places a value may carry. A validation
     * constraint, not a formatting directive — the wire form stays decimal.js-normalized, so
     * `scale=2` accepts `"1250"` and `"1250.5"` as readily as `"1250.50"`.
     */
    scale?: number;
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
    /** Comments appearing after the last field, before the closing `}`. Not attached to any field. Preserved for lossless round-trip. */
    trailingComments?: string[];
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
    /** Comments appearing after the last field, before the closing `}`. Not attached to any field. Preserved for lossless round-trip. */
    trailingComments?: string[];
    type?: ContractTypeNode; // type alias: Name: typeExpression (fields will be empty)
    mode?: ObjectMode; // object validation mode — defaults to 'strict'
    inputCase?: 'camel' | 'snake' | 'pascal'; // format(input=) — key casing of incoming data
    outputCase?: 'camel' | 'snake' | 'pascal'; // format(output=) — key casing of emitted data
    deprecated?: boolean;
    description?: string;
    /** Standalone comment lines preceding the declaration and separated from it by a blank line —
     * section dividers and the like. Not a doc comment. Preserved for lossless round-trip. */
    leadingComments?: string[];
    /** True when `description` was written inline on the header line (`contract X: { # doc`) rather
     * than on its own line above it. Preserved so the formatter reproduces the source form. */
    descriptionInline?: boolean;
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

/** Constrained security declaration. */
export interface SecurityFields {
    /** Named policy required for this endpoint, or `false` to explicitly bypass policy enforcement. */
    policy?: string | false;
    /** Inline comment attached to the `policy:` line. */
    policyDescription?: string;
    /**
     * Standalone comment lines written above the `policy:` line, in source order.
     *
     * Security blocks are where authors record *why* a floor is set where it is, so these are
     * load-bearing prose rather than incidental notes — the formatter has to round-trip them.
     */
    leadingComments?: string[];
    /** Standalone comment lines after the last field, before the closing `}`. */
    trailingComments?: string[];
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

/** JSON-like value tree used for `plugins` entries — strings, numbers, booleans, null, nested objects, and arrays. */
export type PluginValue = string | number | boolean | null | PluginValue[] | { [key: string]: PluginValue };

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

/** One `mime: Type` line under a status code. A status may declare several. */
export interface OpResponseBodyNode {
    contentType: string;
    bodyType: ContractTypeNode;
    /** Comment lines written directly above this mime line. Preserved for lossless round-trip. */
    leadingComments?: string[];
}

/**
 * One status code declared under an operation's `response` block.
 *
 * Whether the service is expected to produce it is derived, not stored — see
 * `emittedResponses`/`observableResponses` in `response-sets.ts`, which read {@link hasBlock},
 * {@link bodies} and {@link emit} to decide.
 */
export interface OpResponseNode {
    statusCode: number;
    /**
     * Every `mime: Type` line declared for this status, in source order. Empty when the status
     * carries no body. A status with more than one entry lets the service pick the mime at
     * runtime; the router then sets `ctx.type` from the returned `contentType`.
     */
    bodies: OpResponseBodyNode[];
    /** Declared response headers for this status code. Undefined = none declared. */
    headers?: OpResponseHeaderNode[];
    /** Set when the status code body declares `headers: none` — suppresses options-level response header merge for this code. */
    headersOptOut?: boolean;
    /**
     * True when the status was written with braces, including an empty pair (`304: {}`).
     *
     * The braces are the signal that the *service* produces this response: an empty block says
     * "returned, carries nothing", while a bare `304:` says the status is documented and
     * something else (middleware, the error path) produces it. Distinct from a bodyless block
     * that only declares headers, which is also braced and also emitted.
     */
    hasBlock?: boolean;
    /**
     * `'documented'` when the status is marked `404(documented):` — part of the OpenAPI, SDK and
     * docs surface, but never written by the generated router. Undefined means the default
     * derivation applies (emitted if it has a block or is 2xx).
     */
    emit?: 'documented';
    /** True when the whole status-code block was written on a single source line
     * (`200: { application/json: Pet }`). Preserved so the formatter doesn't expand it. */
    inline?: boolean;
    /** Comment lines written directly above this status code, inside the `response` block. */
    leadingComments?: string[];
    /** Comment lines written directly above this status's `headers:` block. */
    headersLeadingComments?: string[];
    /** Comment lines left over before the status block's closing brace. */
    trailingComments?: string[];
}

/**
 * Parsed `mcp: { ... }` settings on an operation. Enables MCP tool/route generation
 * for the verb and carries optional MCP tool metadata. The four `*Hint` booleans are the
 * surface form of the `hint:` token list (e.g. `hint: readOnly, nonDestructive`); an unset
 * hint means "not specified" — a consuming MCP plugin applies MCP's own default.
 */
export interface McpConfigNode {
    /** MCP tool id override. When absent, derived from `sdk` → `name` → HTTP method + path. */
    name?: string;
    /** Human-friendly display title for the MCP tool. */
    title?: string;
    /** LLM-facing tool description (distinct from the operation's `#` doc comment). */
    description?: string;
    /** MCP `readOnlyHint`. From `hint: readOnly` / `nonReadOnly`. */
    readOnlyHint?: boolean;
    /** MCP `destructiveHint`. From `hint: destructive` / `nonDestructive`. */
    destructiveHint?: boolean;
    /** MCP `idempotentHint`. From `hint: idempotent` / `nonIdempotent`. */
    idempotentHint?: boolean;
    /** MCP `openWorldHint`. From `hint: openWorld` / `closedWorld`. */
    openWorldHint?: boolean;
    loc: SourceLocation;
}

export interface OpOperationNode {
    method: HttpMethod;
    /**
     * MCP exposure for this verb. `undefined`/`false` = not exposed (the default); `true` =
     * exposed with all metadata derived from the operation; an `McpConfigNode` = exposed with
     * explicit settings. Test enablement with `Boolean(op.mcp)`. Kept as a union so the prettier
     * plugin round-trips the exact authored form (`mcp: true` / `mcp: false` / `mcp: { ... }`).
     */
    mcp?: boolean | McpConfigNode;
    name?: string; // e.g. "Create an Offer" — human-readable name for docs/collections
    service?: string; // e.g. "LedgerService.updateCategoryNesting"
    sdk?: string; // e.g. "getUser" — explicit SDK method name
    /** HMAC signature key name for this endpoint (e.g. `WEBHOOK_SECRET`). Sourced from the bare `signature: KEY` form or the block form's `options:` field. */
    signature?: string;
    /** Inline comment attached to the `signature:` value (the bare value or the block's `options:` line). */
    signatureDescription?: string;
    /** Signature-scoped policy identifier from the block form `signature: { options: KEY, policy: name }`. Distinct from `security.policy`. */
    signaturePolicy?: string;
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
    /** Raw plugin values from the grammar, e.g. `{ bruno: { template: "file://request-token.yml" } }`. */
    plugins?: Record<string, PluginValue>;
    /** Resolved plugin extension values keyed by plugin name. Populated by the CLI resolver — same shape as `plugins`, but every `file://` URL string is replaced with the file's contents. Never set by the parser. */
    pluginExtensions?: Record<string, PluginValue>;
    description?: string;
    /** True when `description` was written inline on the method line (`get: { # doc`) rather than on
     * its own line above it. Preserved so the formatter reproduces the source form. */
    descriptionInline?: boolean;
    /** True when a blank line separated this operation from whatever preceded it inside the route.
     * Preserved so the formatter neither inserts nor removes the author's spacing. */
    blankLineBefore?: boolean;
    /** Body keys in source order, e.g. `['sdk', 'service', 'request', 'responses']`. The formatter
     * emits keys in this order instead of a canonical one so it never reorders a user's file.
     * Absent on programmatically built nodes, in which case canonical order applies. */
    keyOrder?: OpBodyKey[];
    /**
     * Standalone comment lines written above a body key, keyed by the key they precede.
     *
     * A note above `security:` explaining why a verb overrides the file's floor is the common
     * case, and it has to survive formatting. Emitted with the key, so it moves with it if the
     * key order ever changes.
     */
    bodyLeadingComments?: Partial<Record<OpBodyKey, string[]>>;
    /**
     * Standalone comment lines above the verb that are *not* its doc comment.
     *
     * A verb with an inline `# ...` on its own line already has a description, so a `#` block
     * written above it is separate prose — usually the rationale for the verb's security floor.
     * It used to be discarded in favour of the inline comment; it is kept here instead.
     */
    leadingComments?: string[];
    /** Comment lines after the last body key, before the operation's closing brace. */
    bodyTrailingComments?: string[];
    /** Comment lines left over before the `response` block's closing brace, after the last status. */
    responsesTrailingComments?: string[];
    loc: SourceLocation;
}

/** A key that can appear in an operation body, as recorded in {@link OpOperationNode.keyOrder}. */
export type OpBodyKey = 'name' | 'service' | 'sdk' | 'mcp' | 'signature' | 'security' | 'plugins' | 'query' | 'headers' | 'request' | 'responses';

export interface OpRouteNode {
    path: string;
    params?: ParamSource;
    paramsMode?: ObjectMode;
    operations: OpOperationNode[];
    /** Comments appearing after the last operation, before the closing `}`. Not attached to any operation. Preserved for lossless round-trip. */
    trailingComments?: string[];
    /** Route-level modifiers — cascade to all operations unless overridden. */
    modifiers?: RouteModifier[];
    /** Route-level security default — cascades to operations that have no explicit security declaration. */
    security?: SecurityNode;
    description?: string;
    /** Standalone comment lines preceding the declaration and separated from it by a blank line —
     * section dividers and the like. Not a doc comment. Preserved for lossless round-trip. */
    leadingComments?: string[];
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

/** Comments retained from inside a single options sub-block (`keys` or `services`). */
export interface OptionsScopeComments {
    /** Comment lines appearing immediately before an entry, keyed by that entry's key. */
    leading?: Record<string, string[]>;
    /** Trailing `# ...` written on an entry's own line, keyed by that entry's key. */
    inline?: Record<string, string>;
    /** Comment lines after the last entry, before the sub-block's closing `}`. */
    trailing?: string[];
}

/** Comments retained from inside the options block's `keys`/`services` sub-blocks, for lossless round-trip. */
export interface OptionsComments {
    keys?: OptionsScopeComments;
    services?: OptionsScopeComments;
    /** Comments sitting directly in the options block between its sub-blocks. `leading` is keyed by
     * the sub-block the run precedes (`keys`, `services`, `request`, `response`, `security`). */
    body?: OptionsScopeComments;
    /** Comment lines written above the `options` keyword — a file header. */
    leading?: string[];
}

/**
 * Which `keys`/`services` entries had their value written without quotes.
 *
 * Both forms parse to the same string, so this carries no meaning for codegen — it exists only so
 * the formatter can reproduce the authored form. Without it an unquoted subpath import
 * (`PetService: #modules/pet/pet.service.js`) comes back quoted, since quoting is the safe default
 * for a value whose original form is unknown.
 */
export interface OptionsUnquotedValues {
    keys?: string[];
    services?: string[];
}

export interface CkRootNode {
    kind: 'ckRoot';
    meta: Record<string, string>;
    services: Record<string, string>;
    /** Comments retained from inside the options block's `keys`/`services` sub-blocks. Preserved for lossless round-trip. */
    optionsComments?: OptionsComments;
    /** Entries whose value was authored without quotes. Formatting only — see {@link OptionsUnquotedValues}. */
    optionsUnquoted?: OptionsUnquotedValues;
    /** File-level security default — cascades to all routes/operations unless overridden. */
    security?: SecurityNode;
    /** File-level request headers from `options { request: { headers { ... } } }` — merged into every operation's request headers. */
    requestHeaders?: OpResponseHeaderNode[];
    /** File-level response headers from `options { response: { headers { ... } } }` — merged into every status code on every operation. */
    responseHeaders?: OpResponseHeaderNode[];
    models: ModelNode[];
    routes: OpRouteNode[];
    /** Comment lines after the last declaration in the file. Previously a parse error. */
    trailingComments?: string[];
    file: string;
}
