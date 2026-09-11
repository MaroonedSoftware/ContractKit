import type { ContractTypeNode } from '@contractkit/core';

/**
 * Whether a value of `type` can carry a `bigint` once parsed, which is what decides whether its
 * JSON needs the `"123n"` encoding: the SDK's reviver on the way in, and `bigIntReplacer` wherever
 * one is written out.
 *
 * `modelsWithBigInt` is the transitive set from `computeModelsWithScalar`. A `ref` answers from it
 * rather than by walking the model, since a bigint two models down still reaches the wire.
 *
 * A record's key is not checked: a JSON object key is always a string, so a bigint cannot sit
 * there once parsed.
 */
export function typeReachesBigInt(type: ContractTypeNode, modelsWithBigInt: ReadonlySet<string> | undefined): boolean {
    const reaches = (t: ContractTypeNode) => typeReachesBigInt(t, modelsWithBigInt);
    switch (type.kind) {
        case 'scalar':
            return type.name === 'bigint';
        case 'ref':
            return modelsWithBigInt?.has(type.name) ?? false;
        case 'array':
            return reaches(type.item);
        case 'lazy':
            return reaches(type.inner);
        case 'tuple':
            return type.items.some(reaches);
        case 'record':
            return reaches(type.value);
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            return type.members.some(reaches);
        case 'inlineObject':
            return type.fields.some(f => reaches(f.type));
        default:
            // enum, literal
            return false;
    }
}
