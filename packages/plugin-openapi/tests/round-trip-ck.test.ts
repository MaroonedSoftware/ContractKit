import { describe, it, expect } from 'vitest';
import { parseCk, decomposeCk, applyOptionsDefaults, DiagnosticCollector, emittedResponses, thrownResponses } from '@contractkit/core';
import { convertOpenApiToCk } from '@contractkit/openapi-to-ck';
import { parse as parseYaml } from 'yaml';
import { generateOpenApi } from '../src/codegen-openapi.js';

/**
 * `.ck` → OpenAPI → `.ck`.
 *
 * The two directions live in the same repo and can drift apart silently: OpenAPI has no way to
 * say whether the service produces a status or merely documents it, so without the
 * `x-contractkit-emit` extension every `(documented)` error came back as service-produced — a
 * round trip that quietly changed what the generated router and SDKs do.
 *
 * The trip is lossy by design in places (`service:` bindings, named security policies, `plugins:`
 * blocks have no OpenAPI representation). What is asserted here is the contract of what must
 * survive; anything listed as an exclusion is a documented limitation, not an oversight.
 */

const SOURCE = `
contract Pet: {
    id: readonly uuid
    name: string(min=1, max=64)
    code?: string(regex=/^[a-z]+$/)
    status: enum(available, "on hold")
}

contract ApiError: {
    message: string
}

operation /pets/{petId}: {
    params: {
        petId: uuid
    }
    get: {
        name: Fetch one pet
        sdk: getPet
        query: {
            expand?: boolean
        }
        response: {
            200: {
                application/json: Pet
                text/csv: string
                headers: {
                    ETag: string
                }
            }
            404(documented): {
                application/json: ApiError
            }
            500(documented): {
                application/json: ApiError
            }
        }
    }
}
`;

function parse(source: string, file = 'api.ck') {
    const diag = new DiagnosticCollector();
    const root = parseCk(source, file, diag);
    expect(diag.hasErrors()).toBe(false);
    applyOptionsDefaults(root, diag);
    return root;
}

describe('ck → openapi → ck', () => {
    it('preserves the shape a generator depends on', async () => {
        const before = parse(SOURCE);
        const { contract, op } = decomposeCk(before);
        const yaml = generateOpenApi({ contractRoots: [contract], opRoots: [op], config: {} });

        const result = await convertOpenApiToCk({ input: parseYaml(yaml) as Record<string, unknown>, split: 'single' });
        expect(result.warnings.filter(w => w.message.includes('does not parse'))).toEqual([]);
        const after = parse(result.files.get('api.ck')!);

        const opBefore = before.routes[0]!.operations[0]!;
        const opAfter = after.routes[0]!.operations[0]!;

        // The emitted/documented split is the thing this round trip used to destroy.
        expect(emittedResponses(opAfter).map(r => r.statusCode)).toEqual(emittedResponses(opBefore).map(r => r.statusCode));
        expect(thrownResponses(opAfter).map(r => r.statusCode)).toEqual(thrownResponses(opBefore).map(r => r.statusCode));
        expect(emittedResponses(opAfter).map(r => r.statusCode)).toEqual([200]);
        expect(thrownResponses(opAfter).map(r => r.statusCode)).toEqual([404, 500]);

        // Several content types on one status.
        const ok = opAfter.responses.find(r => r.statusCode === 200)!;
        expect(ok.bodies.map(b => b.contentType)).toEqual(['application/json', 'text/csv']);
        expect(ok.headers!.map(h => h.name)).toEqual(['ETag']);

        // Route, verb, name and sdk binding.
        expect(after.routes[0]!.path).toBe('/pets/{petId}');
        expect(opAfter.method).toBe('get');
        expect(opAfter.name).toBe('Fetch one pet');
        expect(opAfter.sdk).toBe('getPet');

        // Models, including a regex and a quoted enum value.
        const pet = after.models.find(m => m.name === 'Pet')!;
        expect(pet.fields.map(f => f.name)).toEqual(['id', 'name', 'code', 'status']);
        expect(pet.fields.find(f => f.name === 'code')!.type).toEqual({ kind: 'scalar', name: 'string', regex: '^[a-z]+$' });
        expect(pet.fields.find(f => f.name === 'status')!.type).toEqual({ kind: 'enum', values: ['available', 'on hold'] });
        expect(pet.fields.find(f => f.name === 'name')!.type).toEqual({ kind: 'scalar', name: 'string', min: 1, max: 64 });
    });

    it('carries the documented marker through the vendor extension, not the status heuristic', async () => {
        // A 2xx marked `(documented)` cannot be recovered from the status code alone, so this
        // isolates the extension from the 4xx/5xx default.
        const before = parse(`
contract Job: { id: uuid }

operation /jobs: {
    post: {
        sdk: startJob
        response: {
            202(documented): {
                application/json: Job
            }
        }
    }
}
`);
        const { contract, op } = decomposeCk(before);
        const yaml = generateOpenApi({ contractRoots: [contract], opRoots: [op], config: {} });
        expect(yaml).toContain('x-contractkit-emit');

        const result = await convertOpenApiToCk({ input: parseYaml(yaml) as Record<string, unknown>, split: 'single' });
        const after = parse(result.files.get('api.ck')!);
        const resp = after.routes[0]!.operations[0]!.responses[0]!;
        expect(resp.statusCode).toBe(202);
        expect(resp.emit).toBe('documented');
    });
});
