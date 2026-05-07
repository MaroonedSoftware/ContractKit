import { describe, it, expect } from 'vitest';
import {
    runIncrementalCodegen,
    parseIncrementalManifest,
    emptyIncrementalManifest,
    hashFingerprint,
    stableStringify,
    INCREMENTAL_MANIFEST_VERSION,
    type IncrementalUnit,
    type IncrementalOutputFile,
} from '../src/incremental.js';

describe('hashFingerprint', () => {
    it('produces the same hash for structurally equivalent payloads', () => {
        expect(hashFingerprint({ a: 1, b: 2 })).toBe(hashFingerprint({ b: 2, a: 1 }));
    });

    it('produces different hashes for different payloads', () => {
        expect(hashFingerprint({ a: 1 })).not.toBe(hashFingerprint({ a: 2 }));
    });
});

describe('stableStringify', () => {
    it('sorts object keys recursively', () => {
        expect(stableStringify({ b: 1, a: { y: 2, x: 1 } })).toBe('{"a":{"x":1,"y":2},"b":1}');
    });

    it('preserves array order', () => {
        expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
    });

    it('handles primitives and null', () => {
        expect(stableStringify(null)).toBe('null');
        expect(stableStringify('s')).toBe('"s"');
        expect(stableStringify(42)).toBe('42');
    });

    it('serializes bigint values as a tagged string', () => {
        // Native JSON.stringify throws "Do not know how to serialize a BigInt" — our
        // wrapper has to handle them so AST nodes carrying bigint defaults can be hashed.
        expect(stableStringify(1n)).toBe('"<bigint:1>"');
        expect(stableStringify({ default: 42n })).toBe('{"default":"<bigint:42>"}');
        // 1n and "1" must hash differently — keep the tag distinguishable.
        expect(stableStringify(1n)).not.toBe(stableStringify('1'));
    });

    it('treats undefined as null so its presence is fingerprinted', () => {
        expect(stableStringify({ a: undefined })).toBe('{"a":null}');
    });
});

describe('parseIncrementalManifest', () => {
    it('returns an empty manifest for malformed JSON', () => {
        const m = parseIncrementalManifest('not json');
        expect(m.version).toBe(INCREMENTAL_MANIFEST_VERSION);
        expect(m.codegenVersion).toBe('');
        expect(m.files).toEqual([]);
        expect(m.units).toEqual({});
    });

    it('returns an empty manifest for a missing version', () => {
        expect(parseIncrementalManifest('{"files":[]}').units).toEqual({});
    });

    it('round-trips a serialized manifest', () => {
        const original = {
            version: INCREMENTAL_MANIFEST_VERSION,
            codegenVersion: '7',
            files: ['a.ts', 'b.ts'],
            units: { 'k': { fingerprint: 'fp1', files: ['a.ts'] } },
        };
        const parsed = parseIncrementalManifest(JSON.stringify(original));
        expect(parsed).toEqual(original);
    });

    it('drops malformed unit entries but keeps well-formed ones', () => {
        const raw = JSON.stringify({
            version: INCREMENTAL_MANIFEST_VERSION,
            codegenVersion: '1',
            files: [],
            units: {
                good: { fingerprint: 'a', files: ['x'] },
                bad1: { fingerprint: 123, files: ['x'] }, // fingerprint not string
                bad2: { fingerprint: 'a', files: 'nope' }, // files not array
            },
        });
        const parsed = parseIncrementalManifest(raw);
        expect(Object.keys(parsed.units)).toEqual(['good']);
    });
});

describe('runIncrementalCodegen', () => {
    function unit(key: string, fingerprint: string, files: IncrementalOutputFile[]): IncrementalUnit {
        return { key, fingerprint, render: () => files };
    }

    it('renders every unit on first run (empty manifest)', () => {
        const result = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: emptyIncrementalManifest('1'),
            globalFiles: [],
            units: [unit('a', 'fp-a', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        expect(result.skippedUnitCount).toBe(0);
        // Manifest is returned separately (not included in filesToWrite) so callers can
        // persist it under the CLI cache dir rather than the plugin's output dir.
        expect(result.filesToWrite.map(f => f.relativePath)).toEqual(['a.ts']);
        expect(result.manifest.units['a']?.files).toEqual(['a.ts']);
        expect(result.deletedPaths).toEqual([]);
    });

    it('skips units whose fingerprint matches and whose files still exist', () => {
        const first = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: emptyIncrementalManifest('1'),
            globalFiles: [],
            units: [unit('a', 'fp', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        let renderCalls = 0;
        const second = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: first.manifest,
            globalFiles: [],
            units: [
                {
                    key: 'a',
                    fingerprint: 'fp',
                    render: () => {
                        renderCalls++;
                        return [{ relativePath: 'a.ts', content: 'A' }];
                    },
                },
            ],
            fileExists: () => true,
        });
        expect(second.skippedUnitCount).toBe(1);
        expect(renderCalls).toBe(0);
        expect(second.filesToWrite).toEqual([]);
    });

    it('regenerates a unit whose fingerprint changed', () => {
        const first = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: emptyIncrementalManifest('1'),
            globalFiles: [],
            units: [unit('a', 'fp1', [{ relativePath: 'a.ts', content: 'old' }])],
            fileExists: () => true,
        });
        const second = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: first.manifest,
            globalFiles: [],
            units: [unit('a', 'fp2', [{ relativePath: 'a.ts', content: 'new' }])],
            fileExists: () => true,
        });
        expect(second.skippedUnitCount).toBe(0);
        expect(second.filesToWrite.find(f => f.relativePath === 'a.ts')?.content).toBe('new');
    });

    it('regenerates a unit whose previously-emitted file is missing on disk', () => {
        const first = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: emptyIncrementalManifest('1'),
            globalFiles: [],
            units: [unit('a', 'fp', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        const second = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: first.manifest,
            globalFiles: [],
            units: [unit('a', 'fp', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => false,
        });
        expect(second.skippedUnitCount).toBe(0);
        expect(second.filesToWrite.map(f => f.relativePath)).toContain('a.ts');
    });

    it('treats every unit as a miss when codegenVersion changes', () => {
        const first = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: emptyIncrementalManifest('1'),
            globalFiles: [],
            units: [unit('a', 'fp', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        const second = runIncrementalCodegen({
            codegenVersion: '2',
            prevManifest: first.manifest,
            globalFiles: [],
            units: [unit('a', 'fp', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        expect(second.skippedUnitCount).toBe(0);
    });

    it('reports paths in the prior manifest but not in the new run as deletedPaths', () => {
        const first = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: emptyIncrementalManifest('1'),
            globalFiles: [],
            units: [
                unit('a', 'fp-a', [{ relativePath: 'a.ts', content: 'A' }]),
                unit('b', 'fp-b', [{ relativePath: 'b.ts', content: 'B' }]),
            ],
            fileExists: () => true,
        });
        const second = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: first.manifest,
            globalFiles: [],
            units: [unit('a', 'fp-a', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        expect(second.deletedPaths).toContain('b.ts');
    });

    it('always writes global files, even when every unit is cached', () => {
        const first = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: emptyIncrementalManifest('1'),
            globalFiles: [{ relativePath: 'aggregator.ts', content: 'old' }],
            units: [unit('a', 'fp', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        const second = runIncrementalCodegen({
            codegenVersion: '1',
            prevManifest: first.manifest,
            globalFiles: [{ relativePath: 'aggregator.ts', content: 'new' }],
            units: [unit('a', 'fp', [{ relativePath: 'a.ts', content: 'A' }])],
            fileExists: () => true,
        });
        expect(second.filesToWrite.find(f => f.relativePath === 'aggregator.ts')?.content).toBe('new');
    });
});
