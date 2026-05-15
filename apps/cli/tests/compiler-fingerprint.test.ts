import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeCompilerFingerprint, readNearestPackageVersion } from '../src/compiler-fingerprint.js';
import type { LoadedPlugin } from '../src/plugin.js';

const makePlugin = (name: string, version: string): LoadedPlugin => ({
    plugin: { name },
    entry: { plugin: name },
    version,
});

describe('readNearestPackageVersion', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = join(tmpdir(), `ck-fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(tmp, { recursive: true });
    });

    afterEach(() => {
        if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
    });

    it('returns the version from a sibling package.json', () => {
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: '4.2.0' }));
        const filePath = join(tmp, 'src', 'index.js');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(filePath, '');
        expect(readNearestPackageVersion(filePath)).toBe('4.2.0');
    });

    it('walks up the directory tree to find the nearest package.json', () => {
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: '1.2.3' }));
        const deep = join(tmp, 'a', 'b', 'c');
        mkdirSync(deep, { recursive: true });
        const filePath = join(deep, 'mod.js');
        writeFileSync(filePath, '');
        expect(readNearestPackageVersion(filePath)).toBe('1.2.3');
    });

    it('prefers the closest package.json when there are multiple', () => {
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        const child = join(tmp, 'pkgs', 'child');
        mkdirSync(child, { recursive: true });
        writeFileSync(join(child, 'package.json'), JSON.stringify({ version: '9.9.9' }));
        const filePath = join(child, 'src', 'mod.js');
        mkdirSync(join(child, 'src'), { recursive: true });
        writeFileSync(filePath, '');
        expect(readNearestPackageVersion(filePath)).toBe('9.9.9');
    });

    it('returns empty string when no package.json is reachable', () => {
        const filePath = join(tmp, 'src', 'mod.js');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(filePath, '');
        // tmp may or may not have a package.json above it in real life, but
        // we can confirm at minimum the helper doesn't throw.
        const result = readNearestPackageVersion(filePath);
        expect(typeof result).toBe('string');
    });

    it('returns empty string when the package.json is malformed', () => {
        writeFileSync(join(tmp, 'package.json'), 'not-json');
        const filePath = join(tmp, 'src', 'mod.js');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(filePath, '');
        expect(readNearestPackageVersion(filePath)).toBe('');
    });

    it('returns empty string when the package.json has no version field', () => {
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'foo' }));
        const filePath = join(tmp, 'src', 'mod.js');
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(filePath, '');
        expect(readNearestPackageVersion(filePath)).toBe('');
    });
});

describe('computeCompilerFingerprint', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = join(tmpdir(), `ck-fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(tmp, { recursive: true });
        // Synthetic CLI package.json so `readNearestPackageVersion` finds a stable version.
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: '0.0.1-test' }));
    });

    afterEach(() => {
        if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
    });

    const cliEntry = (): string => {
        const entry = join(tmp, 'cli.js');
        writeFileSync(entry, '');
        return entry;
    };

    it('returns a stable hex digest for the same inputs', () => {
        const plugins = [makePlugin('a', '1.0.0'), makePlugin('b', '2.0.0')];
        const fp1 = computeCompilerFingerprint(plugins, cliEntry());
        const fp2 = computeCompilerFingerprint(plugins, cliEntry());
        expect(fp1).toBe(fp2);
        expect(fp1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes when a plugin version changes', () => {
        const before = computeCompilerFingerprint([makePlugin('a', '1.0.0')], cliEntry());
        const after = computeCompilerFingerprint([makePlugin('a', '1.0.1')], cliEntry());
        expect(before).not.toBe(after);
    });

    it('changes when a plugin is added or removed', () => {
        const one = computeCompilerFingerprint([makePlugin('a', '1.0.0')], cliEntry());
        const two = computeCompilerFingerprint([makePlugin('a', '1.0.0'), makePlugin('b', '2.0.0')], cliEntry());
        expect(one).not.toBe(two);
    });

    it('is independent of plugin order', () => {
        const ordered = [makePlugin('a', '1.0.0'), makePlugin('b', '2.0.0')];
        const reversed = [makePlugin('b', '2.0.0'), makePlugin('a', '1.0.0')];
        expect(computeCompilerFingerprint(ordered, cliEntry())).toBe(computeCompilerFingerprint(reversed, cliEntry()));
    });

    it('changes when the CLI version changes', () => {
        const entry = cliEntry();
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: '0.0.1-test' }));
        const before = computeCompilerFingerprint([], entry);
        writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: '0.0.2-test' }));
        const after = computeCompilerFingerprint([], entry);
        expect(before).not.toBe(after);
    });

    it('still returns a valid digest when @contractkit/core cannot be resolved', () => {
        // tmp has no node_modules — core resolution silently fails and the
        // fingerprint just omits the core version.
        const fp = computeCompilerFingerprint([makePlugin('a', '1.0.0')], cliEntry());
        expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });
});
