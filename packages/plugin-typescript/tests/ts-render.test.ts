import { describe, it, expect } from 'vitest';
import { sourceLink } from '../src/ts-render.js';

describe('sourceLink', () => {
    it('emits a plain relative path, not a file:// URL', () => {
        // `file://./x.ck` opens an authority component, so `.` parses as the host and the link
        // resolves to nothing. The whole point of the helper is to not do that.
        const link = sourceLink('User', '/out/schemas/user.schema.ts', '/out/contracts/user.ck', 5);
        expect(link).toBe('[User](../contracts/user.ck#L5)');
        expect(link).not.toContain('file://');
    });

    it('relativises the source path against the emitted file, not the process cwd', () => {
        expect(sourceLink('User', '/a/b/c/out.ts', '/a/user.ck')).toBe('[User](../../user.ck)');
    });

    it('prefixes a bare sibling path with ./ so it reads as relative', () => {
        expect(sourceLink('User', '/out/user.schema.ts', '/out/user.ck', 3)).toBe('[User](./user.ck#L3)');
    });

    it('omits the line anchor when no line is given', () => {
        expect(sourceLink('billing.ck', '/out/sdk.ts', '/out/billing.ck')).toBe('[billing.ck](./billing.ck)');
    });

    it('falls back to the source path when there is no output path', () => {
        // Codegen runs without a destination in the prettier plugin and in several tests.
        expect(sourceLink('User', undefined, 'contracts/user.ck', 9)).toBe('[User](./contracts/user.ck#L9)');
    });
});
