import { describe, it, expect } from 'vitest';
import { parseDocument, isMap, isScalar, type Node } from 'yaml';
import { buildOnce } from './harness.js';

/**
 * OpenAPI 3.x requires the keys of a `responses` object to be strings. The generator writes them
 * bare, so a YAML 1.2 parser reads `200:` as the integer `200` and a strict spec validator
 * rejects the document. Reading the emitted text with `toContain` cannot see this; only parsing
 * it can, because the defect is in how a conforming parser interprets the bytes.
 *
 * `parseDocument` rather than `parse`: a plain JS object coerces every key to a string, which
 * destroys the very distinction being checked. The document API keeps each key as a `Scalar`
 * carrying the value the parser actually produced.
 */

const { files } = await buildOnce();

/** The `responses` map of every operation, keyed by a human-readable location. */
function responseMaps(root: Node | null): { where: string; map: unknown }[] {
    const out: { where: string; map: unknown }[] = [];
    if (!isMap(root)) return out;

    const paths = root.get('paths', true);
    if (!isMap(paths)) return out;

    for (const pathItem of paths.items) {
        const path = String(isScalar(pathItem.key) ? pathItem.key.value : pathItem.key);
        if (!isMap(pathItem.value)) continue;

        for (const operation of pathItem.value.items) {
            const method = String(isScalar(operation.key) ? operation.key.value : operation.key);
            if (!isMap(operation.value)) continue;

            const responses = operation.value.get('responses', true);
            if (isMap(responses)) out.push({ where: `${method.toUpperCase()} ${path}`, map: responses });
        }
    }
    return out;
}

describe('generated OpenAPI', () => {
    it('emits every response key as a string, as OpenAPI 3.x requires', () => {
        const yaml = files.openapi.get('openapi.yaml');
        expect(yaml, 'the OpenAPI plugin emitted no openapi.yaml').toBeDefined();

        const findings: string[] = [];
        for (const { where, map } of responseMaps(parseDocument(yaml!).contents)) {
            if (!isMap(map)) continue;
            for (const entry of map.items) {
                if (!isScalar(entry.key) || typeof entry.key.value === 'string') continue;
                findings.push(`${where}: response key ${String(entry.key.value)} parses as ${typeof entry.key.value}, not string`);
            }
        }

        expect(findings.sort()).toEqual([]);
    });
});
