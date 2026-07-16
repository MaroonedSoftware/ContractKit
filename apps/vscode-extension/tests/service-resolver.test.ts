import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveServiceMethod, resolveServiceSourceFile } from '../src/server/service-resolver.js';

const TMP = path.join(os.tmpdir(), `ck-service-resolver-${process.pid}`);
const SERVICE_DIR = path.join(TMP, 'src', 'modules', 'pet');
const SERVICE_TS = path.join(SERVICE_DIR, 'pet.service.ts');

const SERVICE_SOURCE = `\
export class PetService {
    private repo = new Repo();

    async getById(id: string): Promise<Pet> {
        return this.repo.load(id);
    }

    findByStatus(status: string) {
        // a call site that must NOT be mistaken for a declaration
        return this.getById(status);
    }

    remove = (id: string) => this.repo.remove(id);
}
`;

beforeAll(() => {
    fs.mkdirSync(SERVICE_DIR, { recursive: true });
    fs.writeFileSync(SERVICE_TS, SERVICE_SOURCE);
    fs.writeFileSync(
        path.join(TMP, 'package.json'),
        JSON.stringify({ name: 'api', imports: { '#src/*': './src/*' } }),
    );
});

afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
});

describe('resolveServiceSourceFile', () => {
    it('resolves a `#`-subpath import and maps `.js` → `.ts`', () => {
        const file = resolveServiceSourceFile(TMP, '#src/modules/pet/pet.service.js');
        expect(file).toBe(SERVICE_TS);
    });

    it('resolves a bare relative specifier against the base dir', () => {
        const file = resolveServiceSourceFile(TMP, './src/modules/pet/pet.service.js');
        expect(file).toBe(SERVICE_TS);
    });

    it('returns null for a bare package specifier', () => {
        expect(resolveServiceSourceFile(TMP, 'some-pkg/service.js')).toBeNull();
    });

    it('returns null when the source file does not exist', () => {
        expect(resolveServiceSourceFile(TMP, '#src/modules/missing/missing.service.js')).toBeNull();
    });

    it('returns null when no package.json imports match', () => {
        expect(resolveServiceSourceFile(TMP, '#other/pet.service.js')).toBeNull();
    });
});

describe('resolveServiceSourceFile — tsconfig paths', () => {
    // A separate temp project that resolves aliases via tsconfig `paths`, not package.json imports.
    const TS_TMP = path.join(os.tmpdir(), `ck-service-resolver-tsconfig-${process.pid}`);
    const TS_SERVICE_DIR = path.join(TS_TMP, 'src', 'modules', 'pet');
    const TS_SERVICE_TS = path.join(TS_SERVICE_DIR, 'pet.service.ts');

    beforeAll(() => {
        fs.mkdirSync(TS_SERVICE_DIR, { recursive: true });
        fs.writeFileSync(TS_SERVICE_TS, SERVICE_SOURCE);
        // package.json intentionally has NO imports map.
        fs.writeFileSync(path.join(TS_TMP, 'package.json'), JSON.stringify({ name: 'api' }));
        fs.writeFileSync(
            path.join(TS_TMP, 'tsconfig.json'),
            `{
                // tsconfig with comments + trailing commas (JSONC)
                "compilerOptions": {
                    "baseUrl": ".",
                    "paths": {
                        "#modules/*": ["src/modules/*"],
                        "@app/*": ["src/*"],
                    },
                },
            }`,
        );
    });

    afterAll(() => {
        fs.rmSync(TS_TMP, { recursive: true, force: true });
    });

    it('resolves a `#`-alias via tsconfig paths when there is no package.json imports map', () => {
        const file = resolveServiceSourceFile(TS_TMP, '#modules/pet/pet.service.js');
        expect(file).toBe(TS_SERVICE_TS);
    });

    it('resolves a non-`#` alias (e.g. `@app/*`) via tsconfig paths', () => {
        const file = resolveServiceSourceFile(TS_TMP, '@app/modules/pet/pet.service.js');
        expect(file).toBe(TS_SERVICE_TS);
    });

    it('returns null when no tsconfig path pattern matches', () => {
        expect(resolveServiceSourceFile(TS_TMP, '#nope/pet.service.js')).toBeNull();
    });

    it('resolves the method position through the tsconfig-paths alias', () => {
        const pos = resolveServiceMethod(TS_TMP, '#modules/pet/pet.service.js', 'getById');
        expect(pos).not.toBeNull();
        expect(pos!.filePath).toBe(TS_SERVICE_TS);
        expect(pos!.line).toBe(3);
    });
});

describe('resolveServiceMethod', () => {
    it('lands on a class method declaration, not a call site', () => {
        const pos = resolveServiceMethod(TMP, '#src/modules/pet/pet.service.js', 'getById');
        expect(pos).not.toBeNull();
        expect(pos!.filePath).toBe(SERVICE_TS);
        // `async getById(` is on line index 3; `getById` starts at column 10.
        expect(pos!.line).toBe(3);
        expect(pos!.column).toBe(10);
        expect(pos!.length).toBe('getById'.length);
    });

    it('finds an arrow-property method', () => {
        const pos = resolveServiceMethod(TMP, '#src/modules/pet/pet.service.js', 'remove');
        expect(pos!.line).toBe(12);
        expect(pos!.column).toBe(4);
    });

    it('falls back to the top of the file when the method is not found', () => {
        const pos = resolveServiceMethod(TMP, '#src/modules/pet/pet.service.js', 'noSuchMethod');
        expect(pos).toEqual({ filePath: SERVICE_TS, line: 0, column: 0, length: 0 });
    });

    it('returns null when the file cannot be resolved', () => {
        expect(resolveServiceMethod(TMP, '#src/modules/missing/missing.service.js', 'getById')).toBeNull();
    });
});
