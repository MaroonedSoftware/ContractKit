import type { ContractRootNode, ContractTypeNode, OpRootNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

/**
 * Reject the two placements of `decimal` that generators cannot honour.
 *
 * Both are errors rather than warnings, and safely so: `decimal` is a new scalar, so no existing
 * contract can be relying on either shape. Emitting a warning and generating something wrong is the
 * worse trade here — in both cases the failure is silent data corruption or a type that lies.
 */

/** Does this type contain a `decimal` anywhere below it? Does not follow `ref` leaves. */
function hasDecimal(type: ContractTypeNode): boolean {
    switch (type.kind) {
        case 'scalar':
            return type.name === 'decimal';
        case 'array':
            return hasDecimal(type.item);
        case 'lazy':
            return hasDecimal(type.inner);
        case 'tuple':
            return type.items.some(hasDecimal);
        case 'record':
            return hasDecimal(type.key) || hasDecimal(type.value);
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            return type.members.some(hasDecimal);
        case 'inlineObject':
            return type.fields.some(f => hasDecimal(f.type));
        default:
            return false;
    }
}

/**
 * Walk a type looking for a `decimal` inside a plain (undiscriminated) union.
 *
 * The SDK rehydrates a decimal by walking the parsed response to known field positions. In a
 * discriminated union it can pick the arm from the discriminator, but in a plain union it cannot
 * tell which arm arrived. The only fallback — convert if the value happens to be a string — would
 * silently rewrite a genuine `string` field in a sibling arm into a `Decimal`.
 *
 * `T | null` is exempt: nullability is not a real alternative shape, and `extractNullability`
 * strips it before any generator sees the union.
 */
function findDecimalInPlainUnion(type: ContractTypeNode): boolean {
    switch (type.kind) {
        case 'union': {
            const alternatives = type.members.filter(m => !(m.kind === 'scalar' && m.name === 'null'));
            if (alternatives.length > 1 && alternatives.some(hasDecimal)) return true;
            return type.members.some(findDecimalInPlainUnion);
        }
        case 'array':
            return findDecimalInPlainUnion(type.item);
        case 'lazy':
            return findDecimalInPlainUnion(type.inner);
        case 'tuple':
            return type.items.some(findDecimalInPlainUnion);
        case 'record':
            return findDecimalInPlainUnion(type.key) || findDecimalInPlainUnion(type.value);
        case 'discriminatedUnion':
        case 'intersection':
            return type.members.some(findDecimalInPlainUnion);
        case 'inlineObject':
            return type.fields.some(f => findDecimalInPlainUnion(f.type));
        default:
            return false;
    }
}

/** Validate `decimal` placement across every contract and operation root in a project. */
export function validateDecimal(contracts: ContractRootNode[], ops: OpRootNode[], diag: DiagnosticCollector): void {
    for (const root of contracts) {
        for (const model of root.models) {
            const check = (type: ContractTypeNode, where: string, line: number): void => {
                if (findDecimalInPlainUnion(type)) {
                    diag.error(
                        root.file,
                        line,
                        `'${where}' puts a decimal inside an undiscriminated union, which the SDK cannot rehydrate — it has no way to tell which member arrived. Use discriminated(by=...), or move the decimal to a field of its own.`,
                    );
                }
            };
            if (model.type) check(model.type, model.name, model.loc.line);
            for (const field of model.fields) {
                check(field.type, `${model.name}.${field.name}`, field.loc?.line ?? model.loc.line);
            }
        }
    }

    for (const root of ops) {
        for (const route of root.routes) {
            for (const op of route.operations) {
                for (const resp of op.responses ?? []) {
                    for (const header of resp.headers ?? []) {
                        if (hasDecimal(header.type)) {
                            diag.error(
                                root.file,
                                route.loc.line,
                                `Response header '${header.name}' is declared as a decimal, but headers arrive as raw strings with no parsing step — the declared type would be a lie at runtime. Declare it as a body field instead.`,
                            );
                        }
                    }
                }
            }
        }
    }
}
