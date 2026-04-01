import type { DtoRootNode, OpRootNode, DtoTypeNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

/**
 * After all files are parsed, validate that type references point to
 * defined models.
 */
export function validateRefs(dtoRoots: DtoRootNode[], opRoots: OpRootNode[], diag: DiagnosticCollector, allDtoRoots?: DtoRootNode[]): void {
    // Phase 1: Collect all defined model names from ALL dto files (not just changed ones)
    // so that cached/unchanged files don't cause false "not defined" warnings.
    const modelNames = new Set<string>();
    for (const root of allDtoRoots ?? dtoRoots) {
        for (const model of root.models) {
            modelNames.add(model.name);
        }
    }

    // Phase 2: Check DTO type references
    for (const root of dtoRoots) {
        for (const model of root.models) {
            if (model.base && !modelNames.has(model.base)) {
                diag.warn(model.loc.file, model.loc.line, `Base model "${model.base}" is not defined in any contract file`);
            }
            if (model.type) {
                checkTypeRefs(model.type, model.loc.file, model.loc.line, modelNames, diag);
            }
            for (const field of model.fields) {
                checkTypeRefs(field.type, field.loc.file, field.loc.line, modelNames, diag);
            }
        }
    }

    // Phase 3: Check OP type references
    for (const root of opRoots) {
        for (const route of root.routes) {
            checkParamSourceRefs(route.params, root.file, route.loc.line, modelNames, diag);
            for (const op of route.operations) {
                if (op.request?.bodyType) {
                    checkTypeRefs(op.request.bodyType, root.file, op.loc.line, modelNames, diag);
                }
                for (const resp of op.responses) {
                    if (resp.bodyType) {
                        checkTypeRefs(resp.bodyType, root.file, op.loc.line, modelNames, diag);
                    }
                }
                checkParamSourceRefs(op.query, root.file, op.loc.line, modelNames, diag);
                checkParamSourceRefs(op.headers, root.file, op.loc.line, modelNames, diag);
            }
        }
    }
}

function checkTypeRefs(type: DtoTypeNode, file: string, line: number, models: Set<string>, diag: DiagnosticCollector): void {
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
