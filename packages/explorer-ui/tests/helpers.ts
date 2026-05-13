import type {
    ArrayTypeNode,
    ContractTypeNode,
    DiscriminatedUnionTypeNode,
    EnumTypeNode,
    FieldNode,
    HttpMethod,
    InlineObjectTypeNode,
    IntersectionTypeNode,
    LazyTypeNode,
    LiteralTypeNode,
    ModelNode,
    ModelRefTypeNode,
    OpOperationNode,
    OpParamNode,
    RecordTypeNode,
    ScalarTypeNode,
    SourceLocation,
    TupleTypeNode,
    UnionTypeNode,
} from '@contractkit/core';
import type { ResolvedModel, ResolvedOperation } from '../src/types.js';

export const loc = (line = 1, file = '/test.ck'): SourceLocation => ({ file, line });

export const scalar = (name: ScalarTypeNode['name'], mods?: Partial<ScalarTypeNode>): ScalarTypeNode => ({
    kind: 'scalar',
    name,
    ...mods,
});

export const array = (item: ContractTypeNode): ArrayTypeNode => ({ kind: 'array', item });
export const tuple = (...items: ContractTypeNode[]): TupleTypeNode => ({ kind: 'tuple', items });
export const record = (key: ContractTypeNode, value: ContractTypeNode): RecordTypeNode => ({
    kind: 'record',
    key,
    value,
});
export const enumT = (...values: string[]): EnumTypeNode => ({ kind: 'enum', values });
export const literal = (value: string | number | boolean): LiteralTypeNode => ({ kind: 'literal', value });
export const union = (...members: ContractTypeNode[]): UnionTypeNode => ({ kind: 'union', members });
export const discriminated = (discriminator: string, ...members: ContractTypeNode[]): DiscriminatedUnionTypeNode => ({
    kind: 'discriminatedUnion',
    discriminator,
    members,
});
export const intersection = (...members: ContractTypeNode[]): IntersectionTypeNode => ({ kind: 'intersection', members });
export const ref = (name: string): ModelRefTypeNode => ({ kind: 'ref', name });
export const inlineObj = (fields: FieldNode[]): InlineObjectTypeNode => ({ kind: 'inlineObject', fields });
export const lazy = (inner: ContractTypeNode): LazyTypeNode => ({ kind: 'lazy', inner });

export const field = (name: string, type: ContractTypeNode, overrides?: Partial<FieldNode>): FieldNode => ({
    name,
    optional: false,
    nullable: false,
    visibility: 'normal',
    type,
    loc: loc(),
    ...overrides,
});

export const param = (name: string, type: ContractTypeNode, overrides?: Partial<OpParamNode>): OpParamNode => ({
    name,
    optional: false,
    nullable: false,
    type,
    loc: loc(),
    ...overrides,
});

export const model = (name: string, fields: FieldNode[], overrides?: Partial<ModelNode>): ModelNode => ({
    kind: 'model',
    name,
    fields,
    loc: loc(),
    ...overrides,
});

export const op = (method: HttpMethod, overrides?: Partial<OpOperationNode>): OpOperationNode => ({
    method,
    responses: [],
    loc: loc(),
    ...overrides,
});

export const resolvedOp = (
    routePath: string,
    operation: OpOperationNode,
    overrides?: Partial<ResolvedOperation>,
): ResolvedOperation => ({
    filePath: '/test.ck',
    fileGroup: 'test.ck',
    routePath,
    method: operation.method,
    op: operation,
    effectiveModifiers: [],
    ...overrides,
});

export const resolvedModel = (m: ModelNode, filePath = '/test.ck'): ResolvedModel => ({ filePath, model: m });
