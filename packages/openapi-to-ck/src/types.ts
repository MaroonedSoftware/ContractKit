// ─── Public API types ─────────────────────────────────────────────────────

export interface ConvertOptions {
    /** File path, JSON/YAML string, or pre-parsed OpenAPI document object. */
    input: string | Record<string, unknown>;
    /** Output mode: single .ck file or split by OpenAPI tag. Default: 'by-tag'. */
    split?: 'single' | 'by-tag';
    /** Emit OpenAPI descriptions as # comments. Default: true. */
    includeComments?: boolean;
    /**
     * How a 4xx/5xx response that declares a body is imported. Default: `'documented'`.
     *
     * OpenAPI cannot say whether the handler *returns* a status or merely documents it, but
     * `.ck` distinguishes the two and every generator downstream depends on the answer. Writing
     * `404: { … }` means the service produces it: the generated router writes it and the SDKs
     * hand it back as a value. `404(documented): { … }` means the body is the error contract —
     * the SDK throws it as an `SdkError` and the service is not responsible for returning it,
     * which is what an error response almost always is.
     *
     * `'emitted'` reproduces the pre-existing behaviour, where every declared status was imported
     * as service-produced.
     */
    errorResponses?: 'documented' | 'emitted';
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
    exclusiveMinimum?: number | boolean;
    exclusiveMaximum?: number | boolean;
    multipleOf?: number;
    uniqueItems?: boolean;
    discriminator?: { propertyName?: string; mapping?: Record<string, string> };
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
        /** Reusable component objects, inlined by `dereferenceComponents` before conversion. */
        parameters?: Record<string, NormalizedParameter>;
        requestBodies?: Record<string, NormalizedRequestBody>;
        responses?: Record<string, NormalizedResponse>;
        headers?: Record<string, NormalizedHeader>;
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
    /**
     * Set by `@contractkit/plugin-openapi` to carry the emitted-vs-documented distinction, which
     * OpenAPI itself cannot express. Honoured ahead of the status-code heuristic on import.
     */
    'x-contractkit-emit'?: 'documented';
    content?: Record<string, { schema?: NormalizedSchema }>;
    /** OpenAPI Header Objects keyed by header name (case-insensitive on the wire). */
    headers?: Record<string, NormalizedHeader>;
}

export interface NormalizedHeader {
    description?: string;
    required?: boolean;
    deprecated?: boolean;
    schema?: NormalizedSchema;
}
