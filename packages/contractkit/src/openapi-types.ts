export interface OpenApiServerEntry {
    url: string;
    description?: string;
}

export interface OpenApiSecurityScheme {
    type: string;
    scheme?: string;
    bearerFormat?: string;
    name?: string;
    in?: string;
}

export interface OpenApiConfig {
    baseDir?: string;
    output?: string;
    info?: {
        title?: string;
        version?: string;
        description?: string;
    };
    servers?: OpenApiServerEntry[];
    /** Global OpenAPI security requirements (e.g. [{ bearerAuth: [] }]). Distinct from scheme definitions. */
    security?: Record<string, string[]>[];
}
