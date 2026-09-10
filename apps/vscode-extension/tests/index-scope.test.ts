import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitignoreScope } from '../src/shared/index-scope.js';

let tmp: string;

/** Create `rel` under the temp dir with `content`, making parent directories as needed. */
function write(rel: string, content = ''): string {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

function dir(rel: string): string {
    const full = path.join(tmp, rel);
    fs.mkdirSync(full, { recursive: true });
    return full;
}

beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-index-scope-')));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('GitignoreScope', () => {
    it('skips node_modules and .git even without a .gitignore', () => {
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesDir(dir('node_modules'))).toBe(false);
        expect(scope.includesDir(dir('packages/api/node_modules'))).toBe(false);
        expect(scope.includesDir(dir('.git'))).toBe(false);
        expect(scope.includesFile(write('node_modules/pkg/contracts/user.ck'))).toBe(false);
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
    });

    it('skips directories and files a .gitignore names', () => {
        dir('.git');
        write('.gitignore', 'dist/\n*.generated.ck\n');
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesDir(dir('dist'))).toBe(false);
        expect(scope.includesDir(dir('packages/api/dist'))).toBe(false);
        expect(scope.includesFile(write('dist/user.ck'))).toBe(false);
        expect(scope.includesFile(write('contracts/user.generated.ck'))).toBe(false);
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
        expect(scope.includesDir(dir('contracts'))).toBe(true);
    });

    it('applies a nested .gitignore relative to its own directory', () => {
        dir('.git');
        write('packages/api/.gitignore', '/generated/\n');
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesFile(write('packages/api/generated/user.ck'))).toBe(false);
        expect(scope.includesFile(write('packages/web/generated/user.ck'))).toBe(true);
        expect(scope.includesFile(write('generated/user.ck'))).toBe(true);
    });

    it('lets a deeper .gitignore re-include a file a shallower one ignored', () => {
        dir('.git');
        write('.gitignore', '*.ck\n');
        write('contracts/.gitignore', '!*.ck\n');
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
        expect(scope.includesFile(write('scratch/user.ck'))).toBe(false);
    });

    it('never re-includes a file inside an ignored directory', () => {
        dir('.git');
        write('.gitignore', 'build/\n');
        write('build/.gitignore', '!keep.ck\n');
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesFile(write('build/keep.ck'))).toBe(false);
    });

    it('applies rules from above the workspace folder when it sits inside a repository', () => {
        dir('.git');
        write('.gitignore', 'generated/\n');
        const workspace = dir('apps/api');
        const scope = new GitignoreScope([workspace]);
        expect(scope.includesFile(write('apps/api/generated/user.ck'))).toBe(false);
        expect(scope.includesFile(write('apps/api/contracts/user.ck'))).toBe(true);
    });

    it('never excludes a workspace folder, even one its repository ignores', () => {
        dir('.git');
        write('.gitignore', 'dist/\n');
        const workspace = dir('dist');
        const scope = new GitignoreScope([workspace]);
        expect(scope.includesDir(workspace)).toBe(true);
        expect(scope.includesFile(write('dist/user.ck'))).toBe(true);
    });

    it('honors .git/info/exclude', () => {
        write('.git/info/exclude', 'local/\n');
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesFile(write('local/user.ck'))).toBe(false);
        expect(scope.includesFile(write('contracts/user.ck'))).toBe(true);
    });

    it('stops at a nested repository, which has its own rules', () => {
        dir('.git');
        write('.gitignore', '*.generated.ck\n');
        dir('vendor/lib/.git');
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesFile(write('vendor/lib/user.generated.ck'))).toBe(true);
        expect(scope.includesFile(write('user.generated.ck'))).toBe(false);
    });

    it('picks up .gitignore edits after clear()', () => {
        dir('.git');
        const file = write('dist/user.ck');
        const scope = new GitignoreScope([tmp]);
        expect(scope.includesFile(file)).toBe(true);
        write('.gitignore', 'dist/\n');
        expect(scope.includesFile(file)).toBe(true);
        scope.clear();
        expect(scope.includesFile(file)).toBe(false);
    });
});
