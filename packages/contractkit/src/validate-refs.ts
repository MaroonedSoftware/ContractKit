import type { ContractRootNode, OpRootNode, ContractTypeNode, ModelNode, FieldNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

/**
 * After all files are parsed, validate that type references point to
 * defined models.
 */
export function validateRefs(contractRoots: ContractRootNode[], opRoots: OpRootNode[], diag: DiagnosticCollector, allContractRoots?: ContractRootNode[]): void {
    // Phase 1: Collect all defined model names from ALL contract files (not just changed ones)
    // so that cached/unchanged files don't cause false "not defined" warnings.
    const modelNames = new Set<string>();
    const modelMap = new Map<string, ModelNode>();
    for (const root of allContractRoots ?? contractRoots) {
        for (const model of root.models) {
            modelNames.add(model.name);
            modelMap.set(model.name, model);
        }
    }

    // Phase 2: Check contract type references
    for (const root of contractRoots) {
        for (const model of root.models) {
            if (model.bases) {
                for (const base of model.bases) {
                    if (!modelNames.has(base)) {
                        diag.warn(model.loc.file, model.loc.line, `Base model "${base}" is not defined in any contract file`);
                    }
                }
            }
            if (model.type) {
                checkTypeRefs(model.type, model.loc.file, model.loc.line, modelNames, diag);
                checkDiscriminatedUnions(model.type, model.loc.file, model.loc.line, modelMap, diag);
            }
            for (const field of model.fields) {
                checkTypeRefs(field.type, field.loc.file, field.loc.line, modelNames, diag);
                checkDiscriminatedUnions(field.type, field.loc.file, field.loc.line, modelMap, diag);
            }
        }
    }

    // Phase 3: Check OP type references
    for (const root of opRoots) {
        for (const route of root.routes) {
            checkParamSourceRefs(route.params, root.file, route.loc.line, modelNames, diag);
            for (const op of route.operations) {
                if (op.request) {
                    for (const body of op.request.bodies) {
                        checkTypeRefs(body.bodyType, root.file, op.loc.line, modelNames, diag);
                        checkDiscriminatedUnions(body.bodyType, root.file, op.loc.line, modelMap, diag);
                    }
                }
                for (const resp of op.responses) {
                    if (resp.bodyType) {
                        checkTypeRefs(resp.bodyType, root.file, op.loc.line, modelNames, diag);
                        checkDiscriminatedUnions(resp.bodyType, root.file, op.loc.line, modelMap, diag);
                    }
                }
                checkParamSourceRefs(op.query, root.file, op.loc.line, modelNames, diag);
                checkParamSourceRefs(op.headers, root.file, op.loc.line, modelNames, diag);
            }
        }
    }
}

function checkTypeRefs(type: ContractTypeNode, file: string, line: number, models: Set<string>, diag: DiagnosticCollector): void {
    switch (type.kind) {
        case 'ref':
            if (!models.has(type.name)) {
                diag.warn(file, line, `Referenced model "${type.name}" is not defined in any contract file`);
            }
            break;
        case 'array':
            checkTypeRefs(type.item, file, line, models, diag);
            break;
        case 'tuple':
            type.items.forEach(t => checkTypeRefs(t, file, line, models, diag));
            break;
        case 'record':
            checkTypeRefs(type.key, file, line, models, diag);
            checkTypeRefs(type.value, file, line, models, diag);
            break;
        case 'union':
            type.members.forEach(t => checkTypeRefs(t, file, line, models, diag));
            break;
        case 'discriminatedUnion':
            type.members.forEach(t => checkTypeRefs(t, file, line, models, diag));
            break;
        case 'intersection':
            type.members.forEach(t => checkTypeRefs(t, file, line, models, diag));
            break;
        case 'lazy':
            checkTypeRefs(type.inner, file, line, models, diag);
            break;
        case 'inlineObject':
            type.fields.forEach(f => checkTypeRefs(f.type, file, f.loc.line, models, diag));
            break;
    }
}

/**
 * Validate discriminated unions: every member must be a model ref or inline object,
 * and every member must contain a literal-typed field matching the discriminator.
 */
function checkDiscriminatedUnions(type: ContractTypeNode, file: string, line: number, models: Map<string, ModelNode>, diag: DiagnosticCollector): void {
    switch (type.kind) {
        case 'discriminatedUnion': {
            if (!type.discriminator) {
                diag.warn(file, line, `discriminated() requires a "by=<field>" discriminator key`);
            }
            if (type.members.length < 2) {
                diag.warn(file, line, `discriminated() requires at least 2 union members`);
            }
            for (const member of type.members) {
                const fields = resolveMemberFields(member, models);
                if (fields === null) {
                    diag.warn(file, line, `discriminated union member must be a model ref or inline object (got ${describeKind(member)})`);
                    continue;
                }
                const field = fields.find(f => f.name === type.discriminator);
                if (!field) {
                    diag.warn(
                        file,
                        line,
                        `discriminated union member ${describeMember(member)} is missing discriminator field "${type.discriminator}"`,
                    );
                    continue;
                }
                if (field.type.kind !== 'literal' && field.type.kind !== 'enum') {
                    diag.warn(
                        file,
                        line,
                        `discriminated union member ${describeMember(member)} field "${type.discriminator}" must be a literal or enum (got ${describeKind(field.type)})`,
                    );
                }
            }
            // Recurse into nested types as well.
            type.members.forEach(m => checkDiscriminatedUnions(m, file, line, models, diag));
            break;
        }
        case 'array':
            checkDiscriminatedUnions(type.item, file, line, models, diag);
            break;
        case 'tuple':
            type.items.forEach(t => checkDiscriminatedUnions(t, file, line, models, diag));
            break;
        case 'record':
            checkDiscriminatedUnions(type.key, file, line, models, diag);
            checkDiscriminatedUnions(type.value, file, line, models, diag);
            break;
        case 'union':
        case 'intersection':
            type.members.forEach(t => checkDiscriminatedUnions(t, file, line, models, diag));
            break;
        case 'lazy':
            checkDiscriminatedUnions(type.inner, file, line, models, diag);
            break;
        case 'inlineObject':
            type.fields.forEach(f => checkDiscriminatedUnions(f.type, file, f.loc.line, models, diag));
            break;
    }
}

/** Resolve a discriminated-union member to its field list, following ref→model and base inheritance. */
function resolveMemberFields(member: ContractTypeNode, models: Map<string, ModelNode>): FieldNode[] | null {
    if (member.kind === 'inlineObject') return member.fields;
    if (member.kind === 'ref') {
        const model = models.get(member.name);
        if (!model) return null;
        // For aliased models, peer through to the aliased type.
        if (model.type) return resolveMemberFields(model.type, models);
        const fields = [...model.fields];
        if (model.bases) {
            for (const base of model.bases) {
                const baseFields = resolveMemberFields({ kind: 'ref', name: base }, models);
                if (baseFields) fields.push(...baseFields);
            }
        }
        return fields;
    }
    return null;
}

function describeMember(member: ContractTypeNode): string {
    if (member.kind === 'ref') return `"${member.name}"`;
    return `(${describeKind(member)})`;
}

function describeKind(type: ContractTypeNode): string {
    return type.kind;
}

function checkParamSourceRefs(
    source: import('./ast.js').ParamSource | undefined,
    file: string,
    line: number,
    models: Set<string>,
    diag: DiagnosticCollector,
): void {
    if (!source) return;
    if (source.kind === 'ref') {
        checkNameRef(source.name, file, line, models, diag);
    } else if (source.kind === 'params') {
        for (const param of source.nodes) {
            checkTypeRefs(param.type, file, param.loc.line, models, diag);
        }
    } else {
        checkTypeRefs(source.node, file, line, models, diag);
    }
}

function checkNameRef(name: string, file: string, line: number, models: Set<string>, diag: DiagnosticCollector): void {
    if (/^[A-Z]/.test(name) && !models.has(name)) {
        diag.warn(file, line, `Referenced type "${name}" is not defined in any contract file`);
    }
}
