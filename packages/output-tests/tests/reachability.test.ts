import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { computePubliclyReachableModels } from '@contractkit/plugin-docs';
import { buildOnce, parsedFixtures } from './harness.js';

/**
 * The two targets decide "which models are public" from different sources: the Markdown renderer
 * walks the AST, while the Mintlify target reads the spec's `components.schemas`. They should
 * agree, and a divergence would silently give the two outputs different model sets.
 */
describe('model reachability', () => {
    it('agrees between the AST walk and the emitted spec schemas', async () => {
        const { files } = await buildOnce();
        const spec = parseYaml(files.openapi.get('openapi.yaml')!) as {
            components?: { schemas?: Record<string, unknown> };
        };
        const fromSpec = new Set(Object.keys(spec.components?.schemas ?? {}));

        const { contractRoots, opRoots } = parsedFixtures();
        const fromAst = computePubliclyReachableModels(opRoots, contractRoots)!;

        // The AST walk seeds from every referenced type name, including inline ones the spec never
        // names as a schema, so compare only against models the contracts actually declare.
        const declared = new Set(contractRoots.flatMap(r => r.models.map(m => m.name)));
        const astModels = [...fromAst].filter(n => declared.has(n)).sort();

        expect(astModels).toEqual([...fromSpec].sort());
    });
});
