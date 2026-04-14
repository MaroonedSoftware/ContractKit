import { describe, it, expect } from 'vitest';
import { createServerPlugin } from '../src/index.js';
import type { PluginContext } from '@maroonedsoftware/contractkit';
import {
    opRoot,
    opRoute,
    opOperation,
    opParam,
    opRequest,
    opResponse,
    scalarType,
    refType,
    contractRoot,
    model,
    field,
} from './helpers.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeCtx(rootDir = '/project', options: Record<string, unknown> = {}): PluginContext & { emitted: Map<string, string> } {
    const emitted = new Map<string, string>();
    return {
        rootDir,
        options,
        emitFile: (outPath: string, content: string) => { emitted.set(outPath, content); },
        emitted,
    };
}

function inputs(opRoots = [opRoot([opRoute('/users', [opOperation('get')])], '/project/contracts/users.ck')], contractRoots = []) {
    return {
        contractRoots,
        opRoots,
        modelOutPaths: new Map<string, string>(),
        modelsWithInput: new Set<string>(),
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('createServerPlugin', () => {
    describe('output path computation', () => {
        it('uses template variable {filename} in output path', async () => {
            const plugin = createServerPlugin({ output: 'src/routes/{filename}.router.ts' }, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            expect([...ctx.emitted.keys()].some(p => p.endsWith('users.router.ts'))).toBe(true);
        });

        it('respects baseDir when computing output path', async () => {
            const plugin = createServerPlugin({ baseDir: 'apps/api', output: 'src/{filename}.router.ts' }, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            const [outPath] = [...ctx.emitted.keys()];
            expect(outPath).toContain('apps/api');
        });

        it('defaults to {filename}.router.ts when no output template', async () => {
            const plugin = createServerPlugin({}, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            expect([...ctx.emitted.keys()].some(p => p.endsWith('users.router.ts'))).toBe(true);
        });

        it('emits one file per op root', async () => {
            const plugin = createServerPlugin({}, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(
                inputs([
                    opRoot([opRoute('/users', [opOperation('get')])], '/project/contracts/users.ck'),
                    opRoot([opRoute('/payments', [opOperation('get')])], '/project/contracts/payments.ck'),
                ]),
                ctx,
            );
            expect(ctx.emitted.size).toBe(2);
        });
    });

    describe('generated content', () => {
        it('emits a Koa router', async () => {
            const plugin = createServerPlugin({}, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('ServerKitRouter');
        });

        it('includes route path', async () => {
            const plugin = createServerPlugin({}, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs([opRoot([opRoute('/payments/{id}', [opOperation('get')])], '/project/contracts/payments.ck')]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('/payments');
        });

        it('includes service call when servicePathTemplate is set', async () => {
            const plugin = createServerPlugin({ servicePathTemplate: '#services/{module}.service.js' }, '/project');
            const ctx = makeCtx('/project');
            const root = opRoot([opRoute('/users', [opOperation('get', { service: 'UserService.list' })])], '/project/contracts/users.ck');
            await plugin.generateTargets!(inputs([root]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('UserService');
        });

        it('includes request body validation when route has a POST body', async () => {
            const plugin = createServerPlugin({}, '/project');
            const ctx = makeCtx('/project');
            const root = opRoot(
                [opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])],
                '/project/contracts/users.ck',
            );
            await plugin.generateTargets!(inputs([root]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('parseAndValidate');
        });

        it('includes uuid param validation', async () => {
            const plugin = createServerPlugin({}, '/project');
            const ctx = makeCtx('/project');
            const root = opRoot(
                [opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])],
                '/project/contracts/users.ck',
            );
            await plugin.generateTargets!(inputs([root]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('parseAndValidate');
        });

        it('includes response type reference when response has model ref', async () => {
            const plugin = createServerPlugin({}, '/project');
            const ctx = makeCtx('/project');
            const root = opRoot(
                [opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])],
                '/project/contracts/users.ck',
            );
            await plugin.generateTargets!(inputs([root]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('User');
        });
    });

    describe('default plugin export', () => {
        it('plugin has name "server"', async () => {
            const { default: plugin } = await import('../src/index.js');
            expect(plugin.name).toBe('server');
        });

        it('plugin reads config from ctx.options', async () => {
            const { default: plugin } = await import('../src/index.js');
            const ctx = makeCtx('/project', { output: 'src/routes/{filename}.router.ts' });
            await plugin.generateTargets!(inputs(), ctx);
            expect([...ctx.emitted.keys()].some(p => p.endsWith('users.router.ts'))).toBe(true);
        });
    });
});
