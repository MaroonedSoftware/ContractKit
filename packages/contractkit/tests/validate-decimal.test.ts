import { describe, it, expect } from 'vitest';
import { validateProject } from '../src/validate-project.js';

function check(source: string) {
    const { diag } = validateProject({ files: [{ filePath: 'api.ck', source }] });
    return diag.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
}

describe('validateDecimal', () => {
    describe('decimal in an undiscriminated union', () => {
        it('rejects a decimal alongside another type', () => {
            const errors = check('contract M: {\n    amount: decimal | string\n}\n');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatch(/undiscriminated union/);
            expect(errors[0]).toMatch(/M\.amount/);
        });

        // `T | null` is how every nullable field is written, including in contracts/decimal.ck.
        // Treating it as a union would reject the ordinary case.
        it('allows a nullable decimal', () => {
            expect(check('contract M: {\n    amount: decimal | null\n}\n')).toEqual([]);
        });

        it('allows a decimal nested inside a discriminated union member', () => {
            const errors = check(`
contract Card: {
    kind: literal("card")
    fee: decimal
}

contract Cash: {
    kind: literal("cash")
}

contract M: {
    method: discriminated(by=kind, Card | Cash)
}
`);
            expect(errors).toEqual([]);
        });

        it('rejects a decimal reached through an array of a union', () => {
            expect(check('contract M: {\n    xs: array(decimal | string)\n}\n')[0]).toMatch(/undiscriminated union/);
        });

        it('allows a decimal that is not in a union at all', () => {
            expect(check('contract M: {\n    a: decimal\n    b: decimal(scale=2)\n    c: array(decimal)\n}\n')).toEqual([]);
        });

        it('leaves unions without a decimal alone', () => {
            expect(check('contract M: {\n    x: string | int\n}\n')).toEqual([]);
        });
    });

    describe('decimal in a response header', () => {
        it('rejects it, naming the header', () => {
            const errors = check(`
operation /pay: {
    get: {
        sdk: getPay
        response: {
            200: {
                application/json: string
                headers: {
                    X-Total: decimal
                }
            }
        }
    }
}
`);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatch(/X-Total/);
            expect(errors[0]).toMatch(/Declare it as a body field/);
        });

        it('allows a decimal in the response body', () => {
            expect(
                check(`
contract Total: { amount: decimal(scale=2) }

operation /pay: {
    get: {
        sdk: getPay
        response: {
            200: {
                application/json: Total
            }
        }
    }
}
`),
            ).toEqual([]);
        });
    });
});
