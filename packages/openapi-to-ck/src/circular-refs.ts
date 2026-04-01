/**
 * Detects circular $ref chains in OpenAPI schema definitions.
 * Returns the set of schema names that participate in cycles.
 * These should be wrapped in `lazy()` in the output .ck.
 */
export function detectCircularRefs(schemas: Record<string, unknown>): Set<string> {
    const circular = new Set<string>();
    const visiting = new Set<string>(); // current DFS path
    const visited = new Set<string>(); // fully explored

    function visit(name: string): void {
        if (visited.has(name)) return;
        if (visiting.has(name)) {
            circular.add(name);
            return;
        }

        visiting.add(name);
        const schema = schemas[name];
        if (schema && typeof schema === 'object') {
            for (const ref of collectRefs(schema as Record<string, unknown>)) {
                const refName = extractRefName(ref);
                if (refName && schemas[refName]) {
                    visit(refName);
                }
            }
        }
        visiting.delete(name);
        visited.add(name);
    }

    for (const name of Object.keys(schemas)) {
        visit(name);
    }

    return circular;
}

/**
 * Recursively collects all $ref strings from a schema object.
 */
function collectRefs(obj: Record<string, unknown>): string[] {
    const refs: string[] = [];

    function walk(val: unknown): void {
        if (!val || typeof val !== 'object') return;
        if (Array.isArray(val)) {
            for (const item of val) walk(item);
            return;
        }
        const record = val as Record<string, unknown>;
        if (typeof record.$ref === 'string') {
            refs.push(record.$ref);
        }
        for (const v of Object.values(record)) {
            walk(v);
        }
    }

    walk(obj);
    return refs;
}

/**
 * Extracts the schema name from a $ref like "#/components/schemas/Foo"
 * or "#/definitions/Foo" (Swagger 2.0 after normalization still uses components).
 */
export function extractRefName(ref: string): string | undefined {
    const match = ref.match(/^#\/(?:components\/schemas|definitions)\/(.+)$/);
    return match?.[1];
}
