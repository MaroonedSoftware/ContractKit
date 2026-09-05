import { describe, expect, it } from 'vitest';
import { buildModelIndex } from '@contractkit/core';
import { collectHoistedTypes } from '../src/hoist.js';
import { generateKotlinModels, resolveModelsWithInput } from '../src/codegen-models.js';
import { contractRoot, field, literalType, model, refType, scalarType } from './helpers.js';

const PKG = 'com.example.sdk';

/** Two contract files, so cross-file naming and membership are exercised the way a real build is. */
function project(fileA: Parameters<typeof contractRoot>[0], fileB: Parameters<typeof contractRoot>[0]) {
    const rootA = contractRoot(fileA, 'contracts/a.ck');
    const rootB = contractRoot(fileB, 'contracts/b.ck');
    const allModels = [...fileA, ...fileB];
    const modelIndex = buildModelIndex(allModels);
    const modelsWithInput = resolveModelsWithInput(allModels);
    const hoisted = collectHoistedTypes([rootA, rootB], { modelIndex, modelsWithInput });
    const render = (root: typeof rootA) => generateKotlinModels(root, { packageName: PKG, modelsWithInput, modelIndex, hoisted });
    return { hoisted, a: render(rootA), b: render(rootB) };
}

describe('collectHoistedTypes across files', () => {
    it('emits a union in the file that declares it, not in the file its members live in', () => {
        const { a, b } = project(
            [
                model('PaymentMethod', [], {
                    type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] },
                }),
            ],
            [model('Card', [field('kind', literalType('card'))]), model('Bank', [field('kind', literalType('bank'))])],
        );
        expect(a).toContain('sealed interface PaymentMethod');
        expect(b).not.toContain('sealed interface PaymentMethod');
    });

    it('makes a member class declare the interface even though it is generated in another file', () => {
        const { b } = project(
            [
                model('PaymentMethod', [], {
                    type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] },
                }),
            ],
            [model('Card', [field('kind', literalType('card'))]), model('Bank', [field('kind', literalType('bank'))])],
        );
        expect(b).toContain(') : PaymentMethod');
    });

    it('lets one class belong to two unions at once', () => {
        const { hoisted, b } = project(
            [
                model('MethodA', [], { type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] } }),
                model('MethodB', [], { type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Wire')] } }),
            ],
            [
                model('Card', [field('kind', literalType('card'))]),
                model('Bank', [field('kind', literalType('bank'))]),
                model('Wire', [field('kind', literalType('wire'))]),
            ],
        );
        expect(hoisted.memberships.get('Card')).toEqual(['MethodA', 'MethodB']);
        expect(b).toContain(') : MethodA, MethodB');
    });

    it('keeps hoisted names unique across the whole project, not just within one file', () => {
        const { hoisted } = project(
            [model('M', [field('status', { kind: 'enum', values: ['a'] })])],
            [model('MStatus', [field('x', scalarType('string'))])],
        );
        expect(hoisted.byName.has('MStatus')).toBe(false);
        expect(hoisted.byName.has('MStatus2')).toBe(true);
    });

    it('points an Input member class at the Input variant of its union', () => {
        const { a, b } = project(
            [model('Method', [], { type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] } })],
            [
                model('Card', [field('kind', literalType('card')), field('cvv', scalarType('string'), { visibility: 'writeonly' })]),
                model('Bank', [field('kind', literalType('bank'))]),
            ],
        );
        expect(a).toContain('sealed interface MethodInput');
        expect(b).toContain(') : MethodInput');
        expect(a).toContain('is CardInput -> output.json.encodeToJsonElement(CardInput.serializer(), value)');
    });
});
