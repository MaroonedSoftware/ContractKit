import { describe, it, expect } from 'vitest';
import { validateProject } from '../src/validate-project.js';

/**
 * `validateOp`'s own coverage previously lived in `plugin-typescript/tests/pipeline.test.ts`,
 * which is the wrong package for a check that runs in core and applies to every generator.
 */

function warnings(source: string, code?: string): string[] {
    const { diag } = validateProject({ files: [{ filePath: 'api.ck', source }] });
    return diag.diagnostics.filter(d => d.severity === 'warning' && (code === undefined || d.code === code)).map(d => d.message);
}

const OPERATION = (responseBlock: string, method = 'get') => `contract User: {
    id: uuid
}

operation /users: {
    ${method}: {
        service: UserService.list
${responseBlock}
    }
}
`;

describe('no-emitted-response', () => {
    it('warns when every declared response is documentation only', () => {
        const found = warnings(OPERATION('        response: {\n            400:\n            404:\n        }'), 'no-emitted-response');
        expect(found).toHaveLength(1);
        expect(found[0]).toContain('400, 404');
        expect(found[0]).toContain('will return 204');
    });

    it('stays quiet when a success status carries a block', () => {
        expect(warnings(OPERATION('        response: {\n            200: { application/json: User }\n            400:\n        }'), 'no-emitted-response')).toEqual([]);
    });

    it('stays quiet for a bare 2xx, which is emitted despite having no block', () => {
        // The one carve-out in `emittedResponses`: a status is emitted if it has a block, or is 2xx.
        expect(warnings(OPERATION('        response: {\n            204:\n            400:\n        }'), 'no-emitted-response')).toEqual([]);
    });

    it('stays quiet when the operation declares no responses at all', () => {
        // Load-bearing guard. Fixtures throughout the suite declare an operation with no response
        // block, and warning on all of them would be noise about something the author never wrote.
        const source = `operation /users: {
    get: {
        service: UserService.list
    }
}
`;
        expect(warnings(source, 'no-emitted-response')).toEqual([]);
    });

    it('warns for a bodyless operation, which is the common case', () => {
        // The check sits above the `if (!op.request) continue` guard for exactly this reason.
        const found = warnings(OPERATION('        response: {\n            404:\n        }', 'delete'), 'no-emitted-response');
        expect(found).toHaveLength(1);
    });
});
