import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PluginContext } from '@contractkit/core';
import { createSwiftSdkPlugin } from '../src/index.js';
import {
    arrayType,
    contractRoot,
    enumType,
    field,
    inlineObjectType,
    lazyType,
    literalType,
    model,
    opOperation,
    opParam,
    opRequest,
    opResponse,
    opRoot,
    opRoute,
    paramNodes,
    recordType,
    refType,
    scalarType,
    tupleType,
    unionType,
} from './helpers.js';

/**
 * No Swift toolchain runs in this repository's tests, so nothing here proves the output compiles.
 * What it can prove is that the generator never emits structurally broken text: unbalanced
 * brackets, a stringified object, or a hole where a value should be. Those are the failures a
 * `toContain` assertion on one construct at a time would not catch.
 */

const ROOT_DIR = '/project';

/** Every construct the generator has a branch for, in one project. */
const inputs = {
    contractRoots: [
        contractRoot(
            [
                model('Payment', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('secret', scalarType('string'), { visibility: 'writeonly' }),
                    field('amount', scalarType('decimal'), { description: 'How much, exactly.' }),
                    field('quantity', scalarType('bigint')),
                    field('createdAt', scalarType('datetime')),
                    field('day', scalarType('date')),
                    field('at', scalarType('time')),
                    field('takes', scalarType('duration'), { optional: true }),
                    field('blob', scalarType('binary'), { optional: true }),
                    field('note', scalarType('string'), { nullable: true }),
                    field('limit', scalarType('int'), { optional: true, default: 20 }),
                    field('kind', literalType('payment')),
                    field('status', enumType('pending', 'on hold', 'default'), { optional: true, default: 'pending' }),
                    field('tags', arrayType(scalarType('string'))),
                    field('meta', recordType(scalarType('string'), scalarType('unknown'))),
                    field('range', tupleType(scalarType('int'), scalarType('int'))),
                    field('quad', tupleType(scalarType('int'), scalarType('int'), scalarType('int'), scalarType('int'))),
                    field('either', unionType(refType('Card'), scalarType('string'))),
                    field('maybe', unionType(refType('Card'), scalarType('null'))),
                    field('inline', inlineObjectType([field('deep', enumType('a', 'b'))])),
                    field('parent', lazyType(refType('Payment')), { optional: true }),
                    field('class', scalarType('string'), { description: 'A field named for a keyword.' }),
                ]),
                model('Card', [field('kind', literalType('card')), field('last4', scalarType('string'))]),
                model('Bank', [field('kind', literalType('bank'))]),
                model('Method', [], {
                    kind: 'model',
                    type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] },
                } as never),
                model('Token', [field('accessToken', scalarType('string'))], { outputCase: 'snake', inputCase: 'pascal' }),
                model('Ids', [], { type: arrayType(scalarType('uuid')) }),
                model('Empty', []),
            ],
            'contracts/kitchen.ck',
        ),
    ],
    opRoots: [
        opRoot(
            [
                opRoute('/payments', [
                    opOperation('post', {
                        sdk: 'createPayment',
                        request: opRequest('Payment'),
                        responses: [
                            {
                                ...opResponse(200, 'Payment'),
                                headers: [
                                    { name: 'x-request-id', optional: false, type: scalarType('string') },
                                    { name: 'x-cache-hit', optional: true, type: scalarType('boolean') },
                                ],
                            },
                            opResponse(400),
                        ],
                    }),
                    opOperation('get', {
                        sdk: 'listPayments',
                        query: [opParam('limit', scalarType('int'), { optional: true }), opParam('cursor', scalarType('string'))],
                        headers: [opParam('api-key', scalarType('string'), { optional: true })],
                        responses: [opResponse(200, 'array(Payment)')],
                    }),
                ]),
                opRoute(
                    '/payments/{payment-id}',
                    [
                        opOperation('get', {
                            sdk: 'getPayment',
                            responses: [opResponse(200, 'Payment'), { statusCode: 304, bodies: [], hasBlock: true }, opResponse(404)],
                        }),
                        opOperation('put', {
                            sdk: 'replacePayment',
                            request: opRequest('Payment', 'multipart/form-data'),
                            responses: [
                                {
                                    statusCode: 200,
                                    hasBlock: true,
                                    bodies: [
                                        { contentType: 'application/json', bodyType: refType('Payment') },
                                        { contentType: 'text/csv', bodyType: scalarType('string') },
                                    ],
                                },
                            ],
                        }),
                        opOperation('delete', { sdk: 'deletePayment', responses: [opResponse(400)] }),
                    ],
                    paramNodes([opParam('payment-id', scalarType('uuid'))]),
                ),
            ],
            'contracts/kitchen.ck',
        ),
    ],
    modelsWithInput: new Set<string>(),
    modelsWithOutput: new Set<string>(),
};

let emitted: Map<string, string>;

beforeAll(async () => {
    const files = new Map<string, string>();
    const ctx: PluginContext = {
        rootDir: ROOT_DIR,
        options: {},
        cacheEnabled: false,
        cacheDir: mkdtempSync(join(tmpdir(), 'ck-swift-sanity-')),
        emitFile: (outPath, content) => files.set(relative(ROOT_DIR, outPath).split(sep).join('/'), content),
        warn: () => {},
    };
    await createSwiftSdkPlugin({ baseDir: 'out', moduleName: 'KitchenSdk', sdkName: 'Kitchen', scaffold: true }, ROOT_DIR).generateTargets!(
        inputs,
        ctx,
    );
    emitted = files;
});

/** Bracket depth, ignoring anything inside a string literal or a comment. */
function bracketBalance(source: string): Record<string, number> {
    const depth: Record<string, number> = { '{': 0, '(': 0, '[': 0 };
    const closers: Record<string, string> = { '}': '{', ')': '(', ']': '[' };
    let inString = false;
    for (const line of source.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//')) continue;
        for (let i = 0; i < line.length; i++) {
            const char = line[i]!;
            if (inString) {
                if (char === '\\') i++;
                else if (char === '"') inString = false;
                continue;
            }
            if (char === '"') inString = true;
            else if (char in depth) depth[char]!++;
            else if (char in closers) depth[closers[char]!]!--;
        }
        // An unterminated literal would be a bug in this walker, not in the output.
        inString = false;
    }
    return depth;
}

describe('generated Swift', () => {
    it('emits every file the kitchen-sink project calls for', () => {
        expect([...emitted.keys()].sort()).toEqual([
            'out/Package.swift',
            'out/Sources/KitchenSdk/Clients/KitchenClient.swift',
            'out/Sources/KitchenSdk/Kitchen.swift',
            'out/Sources/KitchenSdk/Models/KitchenModels.swift',
            'out/Sources/KitchenSdk/Runtime/JSONValue.swift',
            'out/Sources/KitchenSdk/Runtime/Scalars.swift',
            'out/Sources/KitchenSdk/Runtime/SdkRuntime.swift',
        ]);
    });

    it('balances every bracket in every file', () => {
        for (const [path, source] of emitted) {
            expect({ path, ...bracketBalance(source) }).toEqual({ path, '{': 0, '(': 0, '[': 0 });
        }
    });

    it('leaves no hole where a value should have been', () => {
        for (const [path, source] of emitted) {
            for (const hole of ['undefined', 'NaN', '[object Object]', '${']) {
                expect(`${path}: ${source.includes(hole)}`).toBe(`${path}: false`);
            }
        }
    });

    it('ends every file with exactly one trailing newline', () => {
        for (const [path, source] of emitted) {
            expect(`${path}: ${source.endsWith('\n') && !source.endsWith('\n\n')}`).toBe(`${path}: true`);
        }
    });

    it('opens every generated source with the banner, and never edits it back in twice', () => {
        for (const [path, source] of emitted) {
            if (path.endsWith('Package.swift')) continue;
            expect(source.split('\n')[0]).toBe('// Auto-generated by @contractkit/plugin-swift. Do not edit manually.');
            expect(source.match(/Auto-generated by/g)).toHaveLength(1);
        }
    });

    it('declares each generated type once, so the module has no redeclaration', () => {
        const declared = new Map<string, string>();
        for (const [path, source] of emitted) {
            for (const [, name] of source.matchAll(/^public (?:indirect )?(?:struct|enum|final class|typealias) (\w+)/gm)) {
                expect(`${name} in ${path}`).toBe(`${name} in ${declared.get(name!) ?? path}`);
                declared.set(name!, path);
            }
        }
        expect(declared.size).toBeGreaterThan(10);
    });

    it('gives every switch over a status or a content type a default branch', () => {
        // A switch over an enum is exhaustive on its own, and a default there would be dead code.
        // These two switch over an Int and a String, where Swift demands the branch.
        const client = emitted.get('out/Sources/KitchenSdk/Clients/KitchenClient.swift')!;
        const open = client.match(/^\s*switch response\.(status|contentType) \{$/gm)?.length ?? 0;
        const defaults = client.match(/^\s*default:$/gm)?.length ?? 0;
        expect(open).toBeGreaterThan(0);
        expect(defaults).toBe(open);
    });

    it('marks every statement that can fail, since Swift will not infer it', () => {
        // `try` covers a whole expression, so the check is per statement: a multi-line initializer
        // whose arguments throw needs the one `try` in front of it, not one per line.
        const client = emitted.get('out/Sources/KitchenSdk/Clients/KitchenClient.swift')!;
        const throwing = /http\.(?:decodeJSON|requireHeader|optionalHeader|segment|addQuery|addHeaders|setJSONBody|setFormBody)\(/;
        let statement: string[] = [];
        const statements: string[][] = [];
        for (const line of client.split('\n')) {
            // A continuation line is one that follows an unclosed argument list.
            const open = statement.join('').split('(').length - statement.join('').split(')').length;
            if (statement.length > 0 && open > 0) statement.push(line);
            else {
                if (statement.length > 0) statements.push(statement);
                statement = [line];
            }
        }
        statements.push(statement);

        const failing = statements.filter(lines => throwing.test(lines.join('\n')));
        expect(failing.length).toBeGreaterThan(5);
        for (const lines of failing) {
            const text = lines.join('\n');
            expect(`${lines[0]!.trim()} — has try`).toBe(`${lines[0]!.trim()} — ${text.includes('try ') ? 'has try' : 'missing try'}`);
        }
    });

    it('never wraps an already-optional type in a second layer of Optional', () => {
        for (const source of emitted.values()) expect(source).not.toMatch(/\?\?[^ ]/);
        for (const source of emitted.values()) expect(source).not.toContain('??.self');
    });
});
