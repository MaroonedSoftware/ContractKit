// ─── Public API types ─────────────────────────────────────────────────────

export interface ConvertOptions {
    /** File path, JSON/YAML string, or pre-parsed OpenAPI document object. */
    input: string | Record<string, unknown>;
    /** Output mode: single .ck file or split by OpenAPI tag. Default: 'by-tag'. */
    split?: 'single' | 'by-tag';
    /** Emit OpenAPI descriptions as # comments. Default: true. */
    includeComments?: boolean;
    /** Called for each warning during conversion. */
    onWarning?: (warning: Warning) => void;
}

export interface ConvertResult {
    /** Map of filename -> .ck source text. */
    files: Map<string, string>;
    /** All warnings collected during conversion. */
    warnings: Warning[];
}

export interface Warning {
    /** JSON pointer path into the OpenAPI spec (e.g. "#/components/schemas/Foo"). */
    path: string;
    /** Human-readable description of the issue. */
    message: string;
    /** Severity level. */
    severity: 'info' | 'warn';
}

// ─── Internal types ───────────────────────────────────────────────────────

/** Normalized OpenAPI 3.1 schema object (subset of fields we use). */
export interface NormalizedSchema {
    type?: string | string[];
    format?: string;
    items?: NormalizedSchema;
    prefixItems?: NormalizedSchema[];
    properties?: Record<string, NormalizedSchema>;
    additionalProperties?: boolean | NormalizedSchema;
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    oneOf?: NormalizedSchema[];
    anyOf?: NormalizedSchema[];
    allOf?: NormalizedSchema[];
    $ref?: string;
    nullable?: boolean;
    readOnly?: boolean;
    writeOnly?: boolean;
    deprecated?: boolean;
    default?: unknown;
    description?: string;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    discriminator?: unknown;
    xml?: unknown;
    externalDocs?: unknown;
    not?: unknown;
}

/** Normalized OpenAPI 3.1 document (post-upgrade, post-dereference). */
export interface NormalizedDocument {
    openapi: string;
    info: { title: string; version: string; description?: string };
    paths?: Record<string, NormalizedPathItem>;
    components?: {
        schemas?: Record<string, NormalizedSchema>;
        securitySchemes?: Record<string, unknown>;
    };
    security?: Record<string, string[]>[];
    servers?: { url: string; description?: string }[];
    tags?: { name: string; description?: string }[];
}

export interface NormalizedPathItem {
    summary?: string;
    description?: string;
    parameters?: NormalizedParameter[];
    get?: NormalizedOperation;
    post?: NormalizedOperation;
    put?: NormalizedOperation;
    patch?: NormalizedOperation;
    delete?: NormalizedOperation;
    head?: NormalizedOperation;
    options?: NormalizedOperation;
    trace?: NormalizedOperation;
}

export interface NormalizedOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: NormalizedParameter[];
    requestBody?: NormalizedRequestBody;
    responses?: Record<string, NormalizedResponse>;
    security?: Record<string, string[]>[];
    deprecated?: boolean;
}

export interface NormalizedParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    deprecated?: boolean;
    schema?: NormalizedSchema;
}

export interface NormalizedRequestBody {
    description?: string;
    required?: boolean;
    content?: Record<string, { schema?: NormalizedSchema }>;
}

export interface NormalizedResponse {
    description?: string;
    content?: Record<string, { schema?: NormalizedSchema }>;
}
