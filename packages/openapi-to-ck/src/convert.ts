import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { ConvertOptions, ConvertResult, NormalizedDocument } from './types.js';
import { WarningCollector } from './warnings.js';
import { normalize } from './normalize.js';
import { detectCircularRefs } from './circular-refs.js';
import { schemasToModels, sanitizeName } from './schema-to-ast.js';
import type { SchemaContext } from './schema-to-ast.js';
import { pathsToRoutes } from './paths-to-ast.js';
import { splitByTag, mergeIntoSingle } from './tag-splitter.js';
import { astToCk } from './ast-to-ck.js';
import type { NormalizedSchema } from './types.js';
import type { ModelNode } from '@maroonedsoftware/contractkit';

/**
 * Convert an OpenAPI spec (2.0, 3.0, or 3.1) to Contract Kit .ck source files.
 */
export async function convertOpenApiToCk(options: ConvertOptions): Promise<ConvertResult> {
    const { split = 'by-tag', includeComments = true } = options;
    const warnings = new WarningCollector(options.onWarning);

    // Step 1: Parse the input into a document object
    const rawDoc = await parseInput(options.input);

    // Step 2: Normalize to 3.1 shape
    const doc = normalize(rawDoc, warnings);

    // Step 3: Sanitize schema names
    const schemas = sanitizeSchemaNames(doc, warnings);

    // Step 4: Detect circular references
    const circularRefs = detectCircularRefs(schemas);

    // Step 5: Convert schemas to model AST nodes
    const extractedModels: ModelNode[] = [];
    const schemaCtx: SchemaContext = {
        circularRefs,
        warnings,
        path: '#/components/schemas',
        includeComments,
        namedSchemas: schemas,
        extractedModels,
        inlineCounter: 0,
    };

    const models = schemasToModels(schemas, schemaCtx);

    // Step 6: Convert paths to route AST nodes
    const { routes, routeTags } = pathsToRoutes(doc, {
        circularRefs,
        warnings,
        includeComments,
        namedSchemas: schemas,
        extractedModels,
        globalSecurity: doc.security,
    });

    // Step 7: Split or merge
    const files = new Map<string, string>();

    if (split === 'by-tag') {
        const ckRoots = splitByTag(models, routes, routeTags);
        for (const [filename, root] of ckRoots) {
            files.set(filename, astToCk(root, { includeComments }));
        }
    } else {
        const root = mergeIntoSingle(models, routes);
        files.set('api.ck', astToCk(root, { includeComments }));
    }

    return { files, warnings: warnings.warnings };
}

// ─── Input Parsing ────────────────────────────────────────────────────────

async function parseInput(input: string | Record<string, unknown>): Promise<Record<string, unknown>> {
    // Already a parsed object
    if (typeof input === 'object') {
        return input;
    }

    // Try as a file path first
    try {
        const content = readFileSync(input, 'utf-8');
        return parseJsonOrYaml(content);
    } catch {
        // Not a file path — try parsing as JSON/YAML string
        return parseJsonOrYaml(input);
    }
}

function parseJsonOrYaml(content: string): Record<string, unknown> {
    // Try JSON first (faster)
    try {
        return JSON.parse(content) as Record<string, unknown>;
    } catch {
        // Fall back to YAML
        return parseYaml(content) as Record<string, unknown>;
    }
}

// ─── Schema Name Sanitization ─────────────────────────────────────────────

function sanitizeSchemaNames(doc: NormalizedDocument, warnings: WarningCollector): Record<string, NormalizedSchema> {
    const original = doc.components?.schemas ?? {};
    const sanitized: Record<string, NormalizedSchema> = {};
    const nameMap = new Map<string, string>(); // original → sanitized

    for (const name of Object.keys(original)) {
        const clean = sanitizeName(name, warnings);
        if (sanitized[clean]) {
            warnings.warn(`#/components/schemas/${name}`, `Name collision after sanitization: "${name}" and another schema both map to "${clean}"`);
            // Disambiguate with a suffix
            let i = 2;
            while (sanitized[`${clean}${i}`]) i++;
            nameMap.set(name, `${clean}${i}`);
            sanitized[`${clean}${i}`] = original[name] as NormalizedSchema;
        } else {
            nameMap.set(name, clean);
            sanitized[clean] = original[name] as NormalizedSchema;
        }
    }

    // Update $refs in the document to use sanitized names
    if (nameMap.size > 0) {
        updateRefs(doc, nameMap);
    }

    return sanitized;
}

function updateRefs(obj: unknown, nameMap: Map<string, string>): void {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (const item of obj) updateRefs(item, nameMap);
        return;
    }

    const record = obj as Record<string, unknown>;
    if (typeof record.$ref === 'string') {
        const match = record.$ref.match(/^#\/components\/schemas\/(.+)$/);
        if (match?.[1] && nameMap.has(match[1])) {
            record.$ref = `#/components/schemas/${nameMap.get(match[1])}`;
        }
    }

    for (const value of Object.values(record)) {
        updateRefs(value, nameMap);
    }
}
