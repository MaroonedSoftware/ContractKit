import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { resolveFiles, type GlobFn } from '../src/resolve-files.js';

const ROOT = '/project';

/** A glob that returns canned matches per pattern, in the order given. */
function fakeGlob(byPattern: Record<string, string[]>): GlobFn {
    return async pattern => byPattern[pattern] ?? [];
}

describe('resolveFiles', () => {
    it('sorts matches within a pattern, whatever order the filesystem returned them in', async () => {
        const glob = fakeGlob({ 'c/**/*.ck': ['/project/c/zebra.ck', '/project/c/apple.ck', '/project/c/mango.ck'] });
        expect(await resolveFiles(['c/**/*.ck'], ROOT, glob)).toEqual(['/project/c/apple.ck', '/project/c/mango.ck', '/project/c/zebra.ck']);
    });

    it('produces the same list regardless of the order the filesystem yields', async () => {
        const files = ['/project/c/b.ck', '/project/c/a.ck', '/project/c/d.ck', '/project/c/c.ck'];
        const forward = await resolveFiles(['p'], ROOT, fakeGlob({ p: files }));
        const reversed = await resolveFiles(['p'], ROOT, fakeGlob({ p: [...files].reverse() }));
        expect(forward).toEqual(reversed);
    });

    it('keeps patterns in configured order rather than sorting across them', async () => {
        // A config listing types before operations is expressing an intent; sorting globally
        // would put `operations` first and silently discard it.
        const glob = fakeGlob({
            'types/**/*.ck': ['/project/types/user.ck'],
            'operations/**/*.ck': ['/project/operations/auth.ck'],
        });
        expect(await resolveFiles(['types/**/*.ck', 'operations/**/*.ck'], ROOT, glob)).toEqual([
            '/project/types/user.ck',
            '/project/operations/auth.ck',
        ]);
    });

    it('keeps a file at its first-matched position when two patterns overlap', async () => {
        const glob = fakeGlob({ first: ['/project/a.ck', '/project/shared.ck'], second: ['/project/shared.ck', '/project/b.ck'] });
        expect(await resolveFiles(['first', 'second'], ROOT, glob)).toEqual(['/project/a.ck', '/project/shared.ck', '/project/b.ck']);
    });

    it('sorts by code unit, not by locale', async () => {
        // `localeCompare` would order these by the machine's locale, so the same contracts would
        // compile in a different order on a laptop than in CI.
        const glob = fakeGlob({ p: ['/project/b.ck', '/project/B.ck', '/project/a.ck', '/project/A.ck'] });
        expect(await resolveFiles(['p'], ROOT, glob)).toEqual(['/project/A.ck', '/project/B.ck', '/project/a.ck', '/project/b.ck']);
    });

    it('orders nested paths deterministically', async () => {
        const glob = fakeGlob({ p: ['/project/c/z/one.ck', '/project/c/a/two.ck', '/project/c/a/one.ck'] });
        expect(await resolveFiles(['p'], ROOT, glob)).toEqual(['/project/c/a/one.ck', '/project/c/a/two.ck', '/project/c/z/one.ck']);
    });

    it('resolves the cwd it hands the glob against rootDir', async () => {
        let seen: string | undefined;
        const glob: GlobFn = async (_pattern, options) => {
            seen = options.cwd;
            return [];
        };
        await resolveFiles(['p'], 'relative/root', glob);
        expect(seen).toBe(resolve('relative/root'));
    });

    it('returns nothing when no pattern matches', async () => {
        expect(await resolveFiles(['p'], ROOT, fakeGlob({}))).toEqual([]);
    });
});
