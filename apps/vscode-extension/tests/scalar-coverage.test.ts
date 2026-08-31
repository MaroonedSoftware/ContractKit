import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCALAR_NAMES } from '@contractkit/core';
import { BUILTIN_TYPE_DOCS } from '../src/server/hover-provider.js';

/**
 * Every hand-maintained list of scalar names, checked against the language's own `SCALAR_NAMES`.
 *
 * These lists drift silently. Nothing fails to build when a scalar is missing from the highlighter
 * or the hover map — the editor just quietly stops recognising it, and the gap survives until
 * somebody notices by eye. When this test was added, three lists had already fallen behind:
 * `interval` was missing from completions and hovers, and `duration` from the language reference.
 *
 * The completion and semantic-token providers no longer keep their own copies at all — they derive
 * from `SCALAR_NAMES` directly, which is the better fix where the list is used verbatim. What is
 * left here is everything that cannot: a TextMate regex, a per-scalar documentation map, and a
 * Markdown table.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

describe('scalar coverage', () => {
    it('has scalars to check', () => {
        expect(SCALAR_NAMES.size).toBeGreaterThan(10);
    });

    it('the TextMate grammar highlights every scalar', () => {
        const raw = readFileSync(resolve(__dirname, '../syntaxes/ck.tmLanguage.json'), 'utf-8');
        const alternations = [...raw.matchAll(/\\\\b\((?<body>[a-z|]+)\)\\\\b/g)].map(m => m.groups!.body!.split('|'));
        const scalarAlternation = alternations.find(alt => alt.includes('string') && alt.includes('uuid'));
        expect(scalarAlternation, 'no scalar-name alternation found in ck.tmLanguage.json').toBeDefined();

        const missing = [...SCALAR_NAMES].filter(n => !scalarAlternation!.includes(n));
        expect(missing, 'scalars missing from the TextMate grammar').toEqual([]);
        const extra = scalarAlternation!.filter(n => !SCALAR_NAMES.has(n));
        expect(extra, 'names in the TextMate grammar that are not scalars').toEqual([]);
    });

    it('the hover provider documents every scalar', () => {
        const missing = [...SCALAR_NAMES].filter(n => !(n in BUILTIN_TYPE_DOCS));
        expect(missing, 'scalars with no hover documentation').toEqual([]);
    });

    it('the language reference documents every scalar', () => {
        const doc = readFileSync(resolve(REPO_ROOT, 'docs/language.md'), 'utf-8');
        // The scalar reference is a Markdown table whose first column is a backticked scalar name.
        const documented = new Set([...doc.matchAll(/^\|\s*`([a-z]+)`\s*\|/gm)].map(m => m[1]!));
        const missing = [...SCALAR_NAMES].filter(n => !documented.has(n));
        expect(missing, 'scalars missing from the docs/language.md scalar table').toEqual([]);
    });
});
