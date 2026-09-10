import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitignoreScope } from '../src/shared/index-scope.js';
import { PatternScope } from '../src/server/pattern-scope.js';
import { WorkspaceConfigCache } from '../src/server/workspace-config.js';

let tmp: string;

function write(rel: string, content = ''): string {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

function writeConfig(rel: string, config: Record<string, unknown>): void {
    write(rel, JSON.stringify(config));
}

function scopeFor(...roots: string[]): PatternScope {
    return new PatternScope(new GitignoreScope(roots.length > 0 ? roots : [tmp]), new WorkspaceConfigCache());
}

beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-pattern-scope-')));
    fs.mkdirSync(path.join(tmp, '.git'));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('PatternScope', () => {
    it('keeps only the files a config pattern matches', () => {
        writeConfig('contractkit.config.json', { patterns: ['contracts/types/**/*.ck', 'contracts/operations/**/*.ck'] });
        const scope = scopeFor();
        expect(scope.includesFile(write('contracts/types/user.ck'))).toBe(true);
        expect(scope.includesFile(write('contracts/operations/users/list.ck'))).toBe(true);
        expect(scope.includesFile(write('tests/fixtures/user.ck'))).toBe(false);
        expect(scope.includesFile(write('contracts/scratch.ck'))).toBe(false);
    });

    it('resolves patterns against the config rootDir', () => {
        writeConfig('apps/api/contractkit.config.json', { rootDir: '../../', patterns: ['apps/api/contracts/**/*.ck'] });
        const scope = scopeFor();
        expect(scope.includesFile(write('apps/api/contracts/user.ck'))).toBe(true);
        expect(scope.includesFile(write('apps/api/scratch/user.ck'))).toBe(false);

        writeConfig('apps/api/contractkit.config.json', { patterns: ['contracts/**/*.ck'] });
        const rooted = scopeFor();
        expect(rooted.includesFile(write('apps/api/contracts/user.ck'))).toBe(true);
        expect(rooted.includesFile(write('apps/api/scratch/user.ck'))).toBe(false);
    });

    it('treats a leading ./ in a pattern the way glob does', () => {
        writeConfig('contractkit.config.json', { patterns: ['./contracts/*.ck'] });
        const scope = scopeFor();
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
    });

    it('does not match dotfiles or dot directories, like glob', () => {
        writeConfig('contractkit.config.json', { patterns: ['**/*.ck'] });
        const scope = scopeFor();
        expect(scope.includesFile(write('.drafts/user.ck'))).toBe(false);
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
    });

    it('uses the nearest config when configs are nested', () => {
        writeConfig('contractkit.config.json', { patterns: ['contracts/**/*.ck'] });
        writeConfig('apps/api/contractkit.config.json', { patterns: ['api/**/*.ck'] });
        const scope = scopeFor();
        expect(scope.includesFile(write('apps/api/api/user.ck'))).toBe(true);
        expect(scope.includesFile(write('apps/api/contracts/user.ck'))).toBe(false);
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
    });

    it('falls back to the base scope when the config lists no patterns', () => {
        writeConfig('contractkit.config.json', { plugins: {} });
        const scope = scopeFor();
        expect(scope.includesFile(write('anywhere/user.ck'))).toBe(true);
    });

    it('falls back to the base scope for files outside the config rootDir', () => {
        writeConfig('contractkit.config.json', { rootDir: path.join(tmp, 'elsewhere'), patterns: ['contracts/**/*.ck'] });
        const scope = scopeFor();
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
        expect(scope.includesFile(write('elsewhere/scratch.ck'))).toBe(false);
    });

    it('falls back to the base scope when there is no config', () => {
        const scope = scopeFor();
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
    });

    it('never pulls in a file the base scope excludes', () => {
        write('.gitignore', 'generated/\n');
        writeConfig('contractkit.config.json', { patterns: ['**/*.ck'] });
        const scope = scopeFor();
        expect(scope.includesFile(write('generated/user.ck'))).toBe(false);
        expect(scope.includesFile(write('node_modules/pkg/user.ck'))).toBe(false);
        expect(scope.includesDir(path.join(tmp, 'generated'))).toBe(false);
    });
});
