/**
 * Decompose a unified CkRootNode into separate DtoRootNode + OpRootNode
 * for downstream codegen functions that operate on models or routes independently.
 */
import type { CkRootNode, DtoRootNode, OpRootNode } from './ast.js';

export function decomposeCk(ck: CkRootNode): { dto: DtoRootNode; op: OpRootNode } {
    const dto: DtoRootNode = {
        kind: 'dtoRoot',
        meta: { ...ck.meta },
        services: { ...ck.services },
        models: ck.models,
        file: ck.file,
    };
    const op: OpRootNode = {
        kind: 'opRoot',
        meta: { ...ck.meta },
        services: { ...ck.services },
        security: ck.security,
        routes: ck.routes,
        file: ck.file,
    };
    return { dto, op };
}
