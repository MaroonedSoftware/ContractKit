import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emittedResponses, observableResponses, thrownResponses } from '@contractkit/core';
import { convertAndParse, onlyOperation, responseFor } from './helpers.js';
import { convertOpenApiToCk } from '../src/convert.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const spec = () => JSON.parse(readFileSync(resolve(fixturesDir, 'kitchen-sink-3.1.json'), 'utf-8'));

/**
 * One spec exercising the constructs that have historically broken on import — patterns with a
 * `/`, enum values with quotes, `$ref`'d components, descriptions with newlines, statuses that
 * must not be service-produced, schema names that are not identifiers.
 *
 * The text snapshot is what makes the next grammar or printer change visible in review; the
 * assertions below it state the meaning the generators will read.
 */
describe('kitchen sink', () => {
    it('produces .ck that parses', async () => {
        const { ck } = await convertAndParse({ input: spec() });
        await expect(ck).toMatchFileSnapshot('./__snapshots__/kitchen-sink.ck');
    });

    it('splits by tag without losing a file', async () => {
        const result = await convertOpenApiToCk({ input: spec(), split: 'by-tag' });
        expect(result.warnings.filter(w => w.message.includes('does not parse'))).toEqual([]);
        expect([...result.files.keys()].sort()).toMatchInlineSnapshot(`
          [
            "shared.ck",
            "widgets.ck",
          ]
        `);
    });

    it('gets the response semantics right', async () => {
        const { root } = await convertAndParse({ input: spec() });
        const get = onlyOperation(root);

        // The service writes 200 and 204. A bare `304:` is documented, not produced — something
        // upstream emits it — but a client still observes it, which is why it is in neither the
        // emitted nor the thrown set.
        expect(emittedResponses(get).map(r => r.statusCode)).toEqual([200, 204]);
        expect(observableResponses(get).map(r => r.statusCode)).toEqual([200, 204, 304]);
        expect(thrownResponses(get).map(r => r.statusCode)).toEqual([404, 429, 503]);

        expect(responseFor(get, 200).bodies.map(b => b.contentType)).toEqual(['application/json', 'text/csv']);
        expect(responseFor(get, 200).headers!.map(h => h.name)).toEqual(['X-Rate-Limit']);
        // A `$ref`'d response resolves to the schema behind it.
        expect(responseFor(get, 404).bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'ApiError' });
    });

    it('carries the values that used to emit unparseable source', async () => {
        const { root } = await convertAndParse({ input: spec() });
        const widget = root.models.find(m => m.name === 'Widget')!;
        const typeOf = (name: string) => widget.fields.find(f => f.name === name)!.type;

        expect(typeOf('datePattern')).toEqual({ kind: 'scalar', name: 'string', regex: '^\\d{2}/\\d{2}$' });
        expect(typeOf('kind')).toEqual({ kind: 'enum', values: ['basic', 'on hold', 'a "quoted" kind'] });
        expect(typeOf('ttl')).toEqual({ kind: 'scalar', name: 'duration' });
        expect(typeOf('contact')).toEqual({ kind: 'scalar', name: 'email' });
        expect(typeOf('site')).toEqual({ kind: 'scalar', name: 'url' });
        // A self-reference is a cycle, so it must be lazy or the Zod schema cannot be built.
        expect(typeOf('parent')).toEqual({ kind: 'lazy', inner: { kind: 'ref', name: 'Widget' } });
    });

    it('reports everything it had to drop', async () => {
        const { warnings } = await convertAndParse({ input: spec() });
        const messages = warnings.map(w => w.message);
        for (const expected of [
            '`head` operations',
            '`trace` operations',
            "'default' is not a numeric status code",
            "'4XX' is not a numeric status code",
            'cookie parameters',
            'not a plain type/subtype',
            'exclusiveMinimum',
            'multipleOf',
            'uniqueItems',
        ]) {
            expect(messages.some(m => m.includes(expected)), `expected a warning containing ${expected}`).toBe(true);
        }
    });

    it('handles the model shapes', async () => {
        const { root } = await convertAndParse({ input: spec() });
        const byName = (n: string) => root.models.find(m => m.name === n)!;

        expect(byName('TimestampedWidget').bases).toEqual(['Widget']);
        expect(byName('Shape').type).toEqual({ kind: 'discriminatedUnion', discriminator: 'kind', members: [{ kind: 'ref', name: 'Circle' }, { kind: 'ref', name: 'Square' }] });
        expect(byName('Bag').mode).toBe('loose');
        expect(byName('Sealed').mode).toBeUndefined();
        expect(byName('_3DModel')).toBeDefined();

        const widget = byName('Widget');
        expect(widget.fields.find(f => f.name === 'id')!.visibility).toBe('readonly');
        expect(widget.fields.find(f => f.name === 'secret')!.visibility).toBe('writeonly');
        expect(widget.fields.find(f => f.name === 'legacy')!.deprecated).toBe(true);
        expect(widget.fields.find(f => f.name === 'nickname')!.nullable).toBe(true);
    });

    it('imports the operation label and the spec-level security override', async () => {
        const { root } = await convertAndParse({ input: spec() });
        // `}` and ` #` would have closed the operation block early.
        expect(onlyOperation(root).name).toBe('Fetch a widget with awkward chars');
        const post = root.routes.find(r => r.path === '/widgets')!.operations[0]!;
        expect(post.security).toBe('none');
    });
});
