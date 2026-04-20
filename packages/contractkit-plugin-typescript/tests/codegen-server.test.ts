import { describe, it, expect } from 'vitest';
import { createTypescriptPlugin } from '../src/index.js';
import type { PluginContext } from '@contractkit/core';
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

describe('createTypescriptPlugin (server)', () => {
    describe('output path computation', () => {
        it('uses template variable {filename} in routes output path', async () => {
            const plugin = createTypescriptPlugin({ server: { output: { routes: 'src/routes/{filename}.router.ts' } } }, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            expect([...ctx.emitted.keys()].some(p => p.endsWith('users.router.ts'))).toBe(true);
        });

        it('respects baseDir when computing output path', async () => {
            const plugin = createTypescriptPlugin({ server: { baseDir: 'apps/api', output: { routes: 'src/{filename}.router.ts' } } }, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            const [outPath] = [...ctx.emitted.keys()];
            expect(outPath).toContain('apps/api');
        });

        it('defaults to {filename}.router.ts when no output template', async () => {
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            expect([...ctx.emitted.keys()].some(p => p.endsWith('users.router.ts'))).toBe(true);
        });

        it('emits one route file per op root', async () => {
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
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

        it('emits type files alongside routes when output.types is configured', async () => {
            const plugin = createTypescriptPlugin({
                server: {
                    output: {
                        routes: 'src/routes/{filename}.router.ts',
                        types: 'src/types/{filename}.ts',
                    },
                },
            }, '/project');
            const ctx = makeCtx('/project');
            const contractRoots = [contractRoot([model('User', [field('id', scalarType('uuid'))])], '/project/contracts/users.ck')];
            await plugin.generateTargets!(inputs(undefined, contractRoots as any), ctx);
            expect([...ctx.emitted.keys()].some(p => p.includes('src/types'))).toBe(true);
        });

        it('emits Zod schemas for types when zod: true', async () => {
            const plugin = createTypescriptPlugin({
                server: {
                    zod: true,
                    output: { types: 'src/types/{filename}.ts' },
                },
            }, '/project');
            const ctx = makeCtx('/project');
            const contractRoots = [contractRoot([model('User', [field('id', scalarType('uuid'))])], '/project/contracts/users.ck')];
            await plugin.generateTargets!(inputs([], contractRoots as any), ctx);
            const typeContent = [...ctx.emitted.values()].find(c => c.includes('z.'));
            expect(typeContent).toBeDefined();
        });

        it('emits plain TypeScript types when zod is not set', async () => {
            const plugin = createTypescriptPlugin({
                server: {
                    output: { types: 'src/types/{filename}.ts' },
                },
            }, '/project');
            const ctx = makeCtx('/project');
            const contractRoots = [contractRoot([model('User', [field('id', scalarType('uuid'))])], '/project/contracts/users.ck')];
            await plugin.generateTargets!(inputs([], contractRoots as any), ctx);
            const typeContent = [...ctx.emitted.values()][0]!;
            expect(typeContent).not.toContain('z.');
            expect(typeContent).toContain('export interface User');
        });
    });

    describe('generated content', () => {
        it('emits a Koa router', async () => {
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs(), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('ServerKitRouter');
        });

        it('includes route path', async () => {
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
            const ctx = makeCtx('/project');
            await plugin.generateTargets!(inputs([opRoot([opRoute('/payments/{id}', [opOperation('get')])], '/project/contracts/payments.ck')]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('/payments');
        });

        it('includes service call when servicePathTemplate is set', async () => {
            const plugin = createTypescriptPlugin({ server: { servicePathTemplate: '#services/{module}.service.js' } }, '/project');
            const ctx = makeCtx('/project');
            const root = opRoot([opRoute('/users', [opOperation('get', { service: 'UserService.list' })])], '/project/contracts/users.ck');
            await plugin.generateTargets!(inputs([root]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('UserService');
        });

        it('includes request body validation when route has a POST body', async () => {
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
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
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
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
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
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
        it('plugin has name "typescript"', async () => {
            const { default: plugin } = await import('../src/index.js');
            expect(plugin.name).toBe('typescript');
        });

        it('plugin reads server config from ctx.options.server', async () => {
            const { default: plugin } = await import('../src/index.js');
            const ctx = makeCtx('/project', { server: { output: { routes: 'src/routes/{filename}.router.ts' } } });
            await plugin.generateTargets!(inputs(), ctx);
            expect([...ctx.emitted.keys()].some(p => p.endsWith('users.router.ts'))).toBe(true);
        });
    });
});
