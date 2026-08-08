import { describe, it, expect } from 'vitest';
import * as prettier from 'prettier';
import plugin from '../src/index.js';

/**
 * End-to-end checks that go through prettier itself rather than calling `printCk` directly.
 *
 * `printCk` terminates the file with a newline, so a printer-level test cannot see whether the
 * plugin's doc wrapper preserves it — the plugin used to `trimEnd()` the printed source and
 * return it without re-adding the terminator, so every formatted `.ck` file lost its trailing
 * newline. These tests exercise the layer where that happened.
 */

function format(source: string): Promise<string> {
    return prettier.format(source, { parser: 'contract-ck', plugins: [plugin] });
}

describe('prettier plugin — end to end', () => {
    it('ends the formatted file with exactly one newline', async () => {
        const source = `contract Pet: {
    name: string
}
`;
        const out = await format(source);
        expect(out).toBe(source);
        expect(out.endsWith('\n')).toBe(true);
        expect(out.endsWith('\n\n')).toBe(false);
    });

    it('adds the trailing newline when the source lacks one', async () => {
        const out = await format('contract Pet: {\n    name: string\n}');
        expect(out).toBe('contract Pet: {\n    name: string\n}\n');
    });

    it('does not accumulate blank lines when run twice', async () => {
        const source = `contract Pet: {
    name: string
}
`;
        expect(await format(await format(source))).toBe(source);
    });
});
