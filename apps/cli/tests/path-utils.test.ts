import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertWithinRoot, isOutsideRoot } from '../src/path-utils.js';

describe('isOutsideRoot', () => {
    const root = join(tmpdir(), 'ck-project');

    it('returns false for an in-root path', () => {
        expect(isOutsideRoot(root, join(root, 'src/out.ts'))).toBe(false);
        expect(isOutsideRoot(root, join(root, 'a/b/c/d.ts'))).toBe(false);
    });

    it('returns false for the root itself', () => {
        expect(isOutsideRoot(root, root)).toBe(false);
    });

    it('returns true for a path escaping via ..', () => {
        expect(isOutsideRoot(root, join(root, '../evil.ts'))).toBe(true);
        expect(isOutsideRoot(root, join(root, '../../etc/passwd'))).toBe(true);
    });

    it('returns true for an absolute path outside the root', () => {
        expect(isOutsideRoot(root, '/etc/passwd')).toBe(true);
        expect(isOutsideRoot(root, join(tmpdir(), 'somewhere-else/x.ts'))).toBe(true);
    });

    it('does not treat a sibling with a shared prefix as in-root', () => {
        // `ck-project-evil` shares a string prefix with `ck-project` but is a sibling.
        expect(isOutsideRoot(root, `${root}-evil/x.ts`)).toBe(true);
    });
});

describe('assertWithinRoot', () => {
    const root = join(tmpdir(), 'ck-project');

    it('does not throw for an in-root path', () => {
        expect(() => assertWithinRoot(root, join(root, 'src/out.ts'))).not.toThrow();
    });

    it('throws for a path escaping the root', () => {
        expect(() => assertWithinRoot(root, join(root, '../evil.ts'))).toThrow(/outside project root/);
        expect(() => assertWithinRoot(root, '/etc/passwd')).toThrow(/outside project root/);
    });
});
