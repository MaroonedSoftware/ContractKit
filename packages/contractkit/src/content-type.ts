/**
 * Helpers for classifying mime types declared on `request:` / `response:` blocks.
 *
 * Mime types are stored on the AST as lowercase strings (see `normalizeContentType` in
 * `semantics.ts`). The grammar's `mimeType` rule accepts any RFC 6838-shaped `type/subtype`
 * — codegen branches on the well-known shapes below and falls through to JSON-style
 * serialization for vendor JSON types like `application/vnd.api+json`.
 */

/**
 * True if the mime is JSON-shaped: exactly `application/json`, or any `+json` structured
 * suffix per RFC 6839 (e.g. `application/vnd.api+json`, `application/ld+json`). Codegen
 * uses this to decide between JSON serialization and the form/multipart paths.
 */
export function isJsonMime(contentType: string): boolean {
    if (contentType === 'application/json') return true;
    return /^[a-z0-9.+_-]+\/[a-z0-9.+_-]+\+json$/.test(contentType);
}

/**
 * Classify a mime into the codegen category that drives serialization, validation,
 * and the language types emitted for request bodies and response bodies.
 *
 * - `json`     — `application/json` or any `+json` structured suffix; full schema validation,
 *                JSON.stringify on the wire, model types in source.
 * - `urlencoded` / `multipart` — form-style request bodies with dedicated handling.
 * - `text`     — `text/*`; body is a raw string with no schema enforcement.
 * - `binary`   — anything else (`application/octet-stream`, `image/*`, etc.); body is opaque
 *                bytes (`Blob` / `bytes`) with no schema enforcement.
 */
export type ContentTypeCategory = 'json' | 'urlencoded' | 'multipart' | 'text' | 'binary';

export function classifyContentType(contentType: string): ContentTypeCategory {
    if (contentType === 'application/x-www-form-urlencoded') return 'urlencoded';
    if (contentType === 'multipart/form-data') return 'multipart';
    if (isJsonMime(contentType)) return 'json';
    if (contentType.startsWith('text/')) return 'text';
    return 'binary';
}
