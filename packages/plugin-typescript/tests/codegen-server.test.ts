import { describe, it, expect } from 'vitest';
import { createTypescriptPlugin } from '../src/index.js';
import type { PluginContext } from '@contractkit/core';
import { opRoot, opRoute, opOperation, opParam, opRequest, opResponse, scalarType, refType, contractRoot, model, field } from './helpers.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeCtx(rootDir = '/project', options: Record<string, unknown> = {}): PluginContext & { emitted: Map<string, string> } {
    const emitted = new Map<string, string>();
    return {
        rootDir,
        options,
        cacheEnabled: true,
        emitFile: (outPath: string, content: string) => {
            emitted.set(outPath, content);
        },
        emitted,
    };
}

function inputs(opRoots = [opRoot([opRoute('/users', [opOperation('get')])], '/project/contracts/users.ck')], contractRoots = []) {
    return {
        contractRoots,
        opRoots,
        modelOutPaths: new Map<string, string>(),
        modelsWithInput: new Set<string>(),
        modelsWithOutput: new Set<string>(),
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
            const routeFiles = [...ctx.emitted.keys()].filter(p => p.endsWith('.router.ts'));
            expect(routeFiles.length).toBe(2);
        });

        it('emits type files alongside routes when output.types is configured', async () => {
            const plugin = createTypescriptPlugin(
                {
                    server: {
                        output: {
                            routes: 'src/routes/{filename}.router.ts',
                            types: 'src/types/{filename}.ts',
                        },
                    },
                },
                '/project',
            );
            const ctx = makeCtx('/project');
            const contractRoots = [contractRoot([model('User', [field('id', scalarType('uuid'))])], '/project/contracts/users.ck')];
            await plugin.generateTargets!(inputs(undefined, contractRoots as any), ctx);
            expect([...ctx.emitted.keys()].some(p => p.includes('src/types'))).toBe(true);
        });

        it('emits Zod schemas for types when zod: true', async () => {
            const plugin = createTypescriptPlugin(
                {
                    server: {
                        zod: true,
                        output: { types: 'src/types/{filename}.ts' },
                    },
                },
                '/project',
            );
            const ctx = makeCtx('/project');
            const contractRoots = [contractRoot([model('User', [field('id', scalarType('uuid'))])], '/project/contracts/users.ck')];
            await plugin.generateTargets!(inputs([], contractRoots as any), ctx);
            const typeContent = [...ctx.emitted.values()].find(c => c.includes('z.'));
            expect(typeContent).toBeDefined();
        });

        it('emits plain TypeScript types when zod is not set', async () => {
            const plugin = createTypescriptPlugin(
                {
                    server: {
                        output: { types: 'src/types/{filename}.ts' },
                    },
                },
                '/project',
            );
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
            const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])], '/project/contracts/users.ck');
            await plugin.generateTargets!(inputs([root]), ctx);
            const content = [...ctx.emitted.values()][0]!;
            expect(content).toContain('parseAndValidate');
        });

        it('includes uuid param validation', async () => {
            const plugin = createTypescriptPlugin({ server: {} }, '/project');
            const ctx = makeCtx('/project');
            const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])], '/project/contracts/users.ck');
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

// ─── SDK pipeline: area / subarea grouping ─────────────────────────────────

describe('createTypescriptPlugin (sdk) — area / subarea grouping', () => {
    function findEmitted(emitted: Map<string, string>, suffix: string): string | undefined {
        for (const [path, content] of emitted) {
            if (path.endsWith(suffix)) return content;
        }
        return undefined;
    }

    it('emits a leaf <Area><Subarea>Client and nests it under <Area>Client in sdk.ts', async () => {
        const plugin = createTypescriptPlugin({ sdk: { output: { sdk: 'sdk.ts', clients: '{area}/{subarea}.client.ts' } } }, '/project');
        const ctx = makeCtx('/project');
        const root = opRoot(
            [opRoute('/identity/invitations', [opOperation('post', { sdk: 'createInvitation', responses: [opResponse(201)] })])],
            '/project/contracts/identity-invitations.ck',
            { area: 'identity', subarea: 'invitations' },
        );
        await plugin.generateTargets!(inputs([root]), ctx);

        // Leaf client emitted at the {area}/{subarea}.client.ts path
        const leaf = findEmitted(ctx.emitted, 'identity/invitations.client.ts');
        expect(leaf).toBeDefined();
        expect(leaf!).toContain('export class IdentityInvitationsClient');
        expect(leaf!).toContain('async createInvitation');

        // Aggregator declares IdentityClient + Sdk wiring
        const sdk = findEmitted(ctx.emitted, '/sdk.ts');
        expect(sdk).toBeDefined();
        expect(sdk!).toContain('class IdentityClient {');
        expect(sdk!).toContain('readonly invitations: IdentityInvitationsClient');
        expect(sdk!).toContain('this.invitations = new IdentityInvitationsClient(fetch)');
        expect(sdk!).toContain('export class Sdk {');
        expect(sdk!).toContain('readonly identity: IdentityClient');
        expect(sdk!).toContain('this.identity = new IdentityClient(sdkFetch)');
    });

    it('does NOT emit a standalone client file for an area-level (no-subarea) input — methods inline into sdk.ts', async () => {
        const plugin = createTypescriptPlugin({ sdk: { output: { sdk: 'sdk.ts', clients: '{area}/{filename}.client.ts' } } }, '/project');
        const ctx = makeCtx('/project');
        const root = opRoot(
            [opRoute('/me', [opOperation('get', { sdk: 'getCurrentUser', responses: [opResponse(200)] })])],
            '/project/contracts/identity-me.ck',
            { area: 'identity' },
        );
        await plugin.generateTargets!(inputs([root]), ctx);

        // No per-file leaf for the area-level input
        for (const path of ctx.emitted.keys()) {
            expect(path).not.toMatch(/identity[/-]me\.client\.ts$/);
        }

        // Methods land directly on IdentityClient inside sdk.ts
        const sdk = findEmitted(ctx.emitted, '/sdk.ts');
        expect(sdk).toBeDefined();
        expect(sdk!).toContain('class IdentityClient {');
        expect(sdk!).toContain('async getCurrentUser');
    });

    it('mixes area-level inline methods with subarea property wiring on the same area client', async () => {
        const plugin = createTypescriptPlugin({ sdk: { output: { sdk: 'sdk.ts', clients: '{area}/{filename}.client.ts' } } }, '/project');
        const ctx = makeCtx('/project');
        const me = opRoot(
            [opRoute('/me', [opOperation('get', { sdk: 'getCurrentUser', responses: [opResponse(200)] })])],
            '/project/contracts/identity-me.ck',
            { area: 'identity' },
        );
        const invitations = opRoot(
            [opRoute('/identity/invitations', [opOperation('post', { sdk: 'createInvitation', responses: [opResponse(201)] })])],
            '/project/contracts/identity-invitations.ck',
            { area: 'identity', subarea: 'invitations' },
        );
        await plugin.generateTargets!(inputs([me, invitations]), ctx);

        const sdk = findEmitted(ctx.emitted, '/sdk.ts')!;
        expect(sdk).toContain('class IdentityClient {');
        expect(sdk).toContain('readonly invitations: IdentityInvitationsClient');
        expect(sdk).toContain('async getCurrentUser');
    });

    it('preserves legacy flat wiring for files with no area', async () => {
        const plugin = createTypescriptPlugin({ sdk: { output: { sdk: 'sdk.ts', clients: '{filename}.client.ts' } } }, '/project');
        const ctx = makeCtx('/project');
        const root = opRoot(
            [opRoute('/webhooks', [opOperation('post', { sdk: 'sendWebhook', responses: [opResponse(202)] })])],
            '/project/contracts/webhooks.ck',
        );
        await plugin.generateTargets!(inputs([root]), ctx);

        const sdk = findEmitted(ctx.emitted, '/sdk.ts')!;
        // No <Area>Client wrapper; flat property on Sdk
        expect(sdk).toContain('export class Sdk {');
        expect(sdk).toContain('readonly webhooks: WebhooksClient');
        expect(sdk).toContain('this.webhooks = new WebhooksClient(sdkFetch)');
        expect(sdk).not.toMatch(/class \w+Client \{/m);
    });
});
