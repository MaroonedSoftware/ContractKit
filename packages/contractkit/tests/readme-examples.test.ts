import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCk } from '../src/parser.js';
import { DiagnosticCollector } from '../src/diagnostics.js';

/**
 * The root README's `.ck` blocks are whole, valid files, so they are parsed here rather than
 * trusted. Both the opening example and the cheat sheet are the first thing a reader copies,
 * and prose drifts from the grammar silently — this caught three invalid constructs in the
 * cheat sheet when it was written.
 *
 * Only the README is checked. `docs/language.md` mixes complete files with deliberate fragments
 * (`contract Foo: { ... }`), which would need an opt-out marker to tell the two apart.
 */
describe('README examples', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url).pathname, 'utf8');
    const blocks = [...readme.matchAll(/```(\w*)\n([\s\S]*?)```/g)]
        .filter(m => m[1] === '' && /^(contract|operation|options|#)/m.test(m[2]!))
        .map(m => m[2]!);

    it('finds the .ck blocks', () => {
        expect(blocks.length).toBeGreaterThanOrEqual(2);
    });

    for (const [i, src] of blocks.entries()) {
        it(`block ${i + 1} is valid .ck`, () => {
            const diag = new DiagnosticCollector();
            parseCk(src, `readme-block-${i + 1}.ck`, diag);
            const errors = diag.getAll().filter(d => d.severity === 'error');
            expect(errors.map(e => `line ${e.line}: ${e.message}`)).toEqual([]);
        });
    }
});
