import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiagnosticCollector } from '@contractkit/core';
import type { OpRootNode, OpRouteNode, OpOperationNode } from '@contractkit/core';
import { resolvePluginFiles } from '../src/resolve-plugin-files.js';

function makeOp(overrides: Partial<OpOperationNode> = {}): OpOperationNode {
    return {
        method: 'get',
        responses: [],
        loc: { file: 'test.ck', line: 1 },
        ...overrides,
    };
}

function makeRoute(path: string, operations: OpOperationNode[]): OpRouteNode {
    return { path, operations, loc: { file: 'test.ck', line: 1 } };
}

function makeRoot(file: string, routes: OpRouteNode[]): OpRootNode {
    return { kind: 'opRoot', meta: {}, routes, file };
}

describe('resolvePluginFiles', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = join(tmpdir(), `contractkit-resolve-test-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads file content into op.pluginFiles when file exists', () => {
        const content = 'info:\n  name: Custom Request\n  type: http\n';
        writeFileSync(join(tmpDir, 'stub.yml'), content, 'utf-8');

        const op = makeOp({ plugins: { bruno: 'stub.yml' } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        resolvePluginFiles([root], tmpDir, diag);

        expect(op.pluginFiles).toBeDefined();
        expect(op.pluginFiles!['bruno']).toBe(content);
        expect(diag.hasErrors()).toBe(false);
    });

    it('emits a warning and leaves pluginFiles unset for missing file', () => {
        const op = makeOp({ plugins: { bruno: 'missing.yml' } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        resolvePluginFiles([root], tmpDir, diag);

        expect(op.pluginFiles).toBeUndefined();
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('missing.yml');
    });

    it('resolves plugin file path relative to the contract file directory', () => {
        const subDir = join(tmpDir, 'contracts');
        mkdirSync(subDir, { recursive: true });
        writeFileSync(join(subDir, 'override.yml'), 'content', 'utf-8');

        const op = makeOp({ plugins: { bruno: 'override.yml' } });
        const root = makeRoot(join(subDir, 'users.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        resolvePluginFiles([root], tmpDir, diag);

        expect(op.pluginFiles!['bruno']).toBe('content');
        expect(diag.hasErrors()).toBe(false);
    });

    it('skips ops without a plugins block', () => {
        const op = makeOp();
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        resolvePluginFiles([root], tmpDir, diag);

        expect(op.pluginFiles).toBeUndefined();
        expect(diag.getAll()).toHaveLength(0);
    });

    it('resolves multiple plugin entries on the same op', () => {
        writeFileSync(join(tmpDir, 'a.yml'), 'aaa', 'utf-8');
        writeFileSync(join(tmpDir, 'b.yml'), 'bbb', 'utf-8');

        const op = makeOp({ plugins: { bruno: 'a.yml', other: 'b.yml' } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        resolvePluginFiles([root], tmpDir, diag);

        expect(op.pluginFiles!['bruno']).toBe('aaa');
        expect(op.pluginFiles!['other']).toBe('bbb');
    });
});
