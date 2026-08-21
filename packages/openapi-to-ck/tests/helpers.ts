import { parseCk, DiagnosticCollector } from '@contractkit/core';
import { convertOpenApiToCk } from '../src/convert.js';
import type { ConvertOptions, Warning } from '../src/types.js';
import type {
    CkRootNode,
    ModelNode,
    FieldNode,
    ContractTypeNode,
    ScalarTypeNode,
    ArrayTypeNode,
    TupleTypeNode,
    RecordTypeNode,
    EnumTypeNode,
    LiteralTypeNode,
    UnionTypeNode,
    IntersectionTypeNode,
    ModelRefTypeNode,
    InlineObjectTypeNode,
    LazyTypeNode,
    SourceLocation,
    OpRouteNode,
    OpOperationNode,
    OpParamNode,
    OpRequestNode,
    OpResponseNode,
    HttpMethod,
    ParamSource,
    RouteModifier,
    SecurityNode,
} from '@contractkit/core';

// ─── AST Builder Helpers ────────────────────────────────────────────────────

export function loc(line = 1, file = 'test.ck'): SourceLocation {
    return { file, line };
}

export function scalarType(name: ScalarTypeNode['name'], mods?: Partial<ScalarTypeNode>): ScalarTypeNode {
    return { kind: 'scalar', name, ...mods };
}

export function arrayType(item: ContractTypeNode, mods?: { min?: number; max?: number }): ArrayTypeNode {
    return { kind: 'array', item, ...mods };
}

export function tupleType(...items: ContractTypeNode[]): TupleTypeNode {
    return { kind: 'tuple', items };
}

export function recordType(key: ContractTypeNode, value: ContractTypeNode): RecordTypeNode {
    return { kind: 'record', key, value };
}

export function enumType(...values: string[]): EnumTypeNode {
    return { kind: 'enum', values };
}

export function literalType(value: string | number | boolean): LiteralTypeNode {
    return { kind: 'literal', value };
}

export function unionType(...members: ContractTypeNode[]): UnionTypeNode {
    return { kind: 'union', members };
}

export function intersectionType(...members: ContractTypeNode[]): IntersectionTypeNode {
    return { kind: 'intersection', members };
}

export function refType(name: string): ModelRefTypeNode {
    return { kind: 'ref', name };
}

export function inlineObjectType(fields: FieldNode[]): InlineObjectTypeNode {
    return { kind: 'inlineObject', fields };
}

export function lazyType(inner: ContractTypeNode): LazyTypeNode {
    return { kind: 'lazy', inner };
}

export function field(name: string, type: ContractTypeNode, overrides?: Partial<FieldNode>): FieldNode {
    return {
        name,
        optional: false,
        nullable: false,
        visibility: 'normal',
        type,
        loc: loc(),
        ...overrides,
    };
}

export function model(name: string, fields: FieldNode[], overrides?: Partial<ModelNode>): ModelNode {
    return {
        kind: 'model',
        name,
        fields,
        loc: loc(),
        ...overrides,
    };
}

export function ckRoot(overrides?: Partial<CkRootNode>): CkRootNode {
    return {
        kind: 'ckRoot',
        meta: {},
        services: {},
        models: [],
        routes: [],
        file: 'test.ck',
        ...overrides,
    };
}

export function opParam(name: string, type: ContractTypeNode, overrides?: Partial<OpParamNode>): OpParamNode {
    return { name, optional: false, nullable: false, type, loc: loc(), ...overrides };
}

export function opRequest(bodyType: ContractTypeNode, contentType: string = 'application/json'): OpRequestNode {
    return {
        bodies: [
            {
                contentType: contentType as OpRequestNode['bodies'][number]['contentType'],
                bodyType,
            },
        ],
    };
}

export function opResponse(statusCode: number, bodyType?: ContractTypeNode, contentType?: 'application/json'): OpResponseNode {
    const bodies = bodyType === undefined ? [] : [{ contentType: contentType ?? 'application/json', bodyType }];
    return { statusCode, bodies, ...(bodyType !== undefined ? { hasBlock: true } : {}) };
}

/** Normalize a raw param value (old bare format or new discriminated union) to ParamSource. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParamSource(value: any): ParamSource {
    if (!value) return value;
    if (typeof value === 'string') return { kind: 'ref', name: value };
    if (Array.isArray(value)) return { kind: 'params', nodes: value };
    if (value.kind === 'params' || value.kind === 'ref' || value.kind === 'type') return value as ParamSource;
    return { kind: 'type', node: value as ContractTypeNode };
}

export function opOperation(method: HttpMethod, overrides?: Partial<OpOperationNode> & { query?: unknown; headers?: unknown }): OpOperationNode {
    const normalized = { ...overrides } as Partial<OpOperationNode>;
    if (overrides?.query !== undefined) normalized.query = normalizeParamSource(overrides.query);
    if (overrides?.headers !== undefined) normalized.headers = normalizeParamSource(overrides.headers);
    return {
        method,
        responses: [],
        loc: loc(),
        ...normalized,
    };
}

export function opRoute(path: string, operations: OpOperationNode[], overrides?: Partial<OpRouteNode> & { params?: unknown }): OpRouteNode {
    const normalized = { ...overrides } as Partial<OpRouteNode>;
    if (overrides?.params !== undefined) normalized.params = normalizeParamSource(overrides.params);
    return { path, operations, loc: loc(), ...normalized };
}

// ─── Conversion round-trip ────────────────────────────────────────────────

/**
 * Convert a spec and parse the result back, asserting it is clean `.ck`.
 *
 * Substring assertions over the emitted text cannot tell "the output parses but means the wrong
 * thing" from "the output is correct" — which is exactly the class of bug that let every error
 * response import as service-produced. Asserting on the parsed AST states the meaning instead of
 * the formatting, and re-parsing catches source the printer cannot actually express.
 */
export async function convertAndParse(options: ConvertOptions & { file?: string }): Promise<{ root: CkRootNode; ck: string; warnings: Warning[] }> {
    const file = options.file ?? 'api.ck';
    const result = await convertOpenApiToCk({ split: 'single', ...options });
    const ck = result.files.get(file);
    if (ck === undefined) {
        throw new Error(`no ${file} in output; got: ${[...result.files.keys()].join(', ')}`);
    }
    const diag = new DiagnosticCollector();
    const root = parseCk(ck, file, diag);
    if (diag.hasErrors()) {
        throw new Error(`generated ${file} does not parse:\n${diag.getAll().map(d => `  ${d.line}: ${d.message}`).join('\n')}\n\n${ck}`);
    }
    return { root, ck, warnings: result.warnings };
}

/** The single operation of a single-route conversion. */
export function onlyOperation(root: CkRootNode): OpOperationNode {
    return root.routes[0]!.operations[0]!;
}

/** Look up one response by status code. */
export function responseFor(op: OpOperationNode, statusCode: number): OpResponseNode {
    const resp = op.responses.find(r => r.statusCode === statusCode);
    if (!resp) throw new Error(`no ${statusCode} response; got ${op.responses.map(r => r.statusCode).join(', ')}`);
    return resp;
}
