import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@contractkit/core';
import { assertValidConfig, createCSharpSdkPlugin } from '../src/index.js';
import { contractRoot, field, model, opOperation, opResponse, opRoot, opRoute, scalarType } from './helpers.js';

const ROOT_DIR = '/project';

/** A `PluginContext` that captures `emitFile` in memory, keyed by rootDir-relative POSIX path. */
export function makeCtx(): PluginContext & { emitted: Map<string, string>; ifAbsent: string[] } {
    const emitted = new Map<string, string>();
    const ifAbsent: string[] = [];
    return {
        rootDir: ROOT_DIR,
        options: {},
        cacheEnabled: false,
        cacheDir: mkdtempSync(join(tmpdir(), 'ck-csharp-')),
        emitFile: (outPath, content, opts) => {
            const key = relative(ROOT_DIR, outPath).split(sep).join('/');
            emitted.set(key, content);
            if (opts?.ifAbsent) ifAbsent.push(key);
        },
        emitted,
        ifAbsent,
    };
}

export const INPUTS = {
    contractRoots: [contractRoot([model('Payment', [field('id', scalarType('uuid'))])], 'contracts/billing.ck')],
    opRoots: [
        opRoot(
            [opRoute('/payments', [opOperation('get', { sdk: 'listPayments', responses: [opResponse(200, 'Payment')] })])],
            'contracts/billing.ck',
        ),
    ],
    modelsWithInput: new Set<string>(),
    modelsWithOutput: new Set<string>(),
};

describe('assertValidConfig', () => {
    it('accepts a valid config and an empty one', () => {
        expect(() => assertValidConfig({})).not.toThrow();
        expect(() => assertValidConfig({ namespace: 'Acme.Sdk', sdkName: 'AcmeSdk', scaffold: true })).not.toThrow();
    });

    it('rejects a namespace segment that is not an identifier', () => {
        expect(() => assertValidConfig({ namespace: 'Acme.1Bad' })).toThrow(/not a valid C# namespace/);
        expect(() => assertValidConfig({ namespace: 'Acme..Sdk' })).toThrow(/not a valid C# namespace/);
        expect(() => assertValidConfig({ namespace: 'Acme/Sdk' })).toThrow(/not a valid C# namespace/);
    });

    it('rejects a namespace segment that is a C# keyword', () => {
        expect(() => assertValidConfig({ namespace: 'Acme.event.Sdk' })).toThrow(/contains the C# keyword 'event'/);
    });

    it('rejects an sdkName that is not a class name', () => {
        expect(() => assertValidConfig({ sdkName: '2Sdk' })).toThrow(/not a valid C# class name/);
        expect(() => assertValidConfig({ sdkName: 'class' })).toThrow(/is a C# keyword/);
    });

    it('rejects non-boolean flags, which JSON config cannot be trusted to type', () => {
        expect(() => assertValidConfig({ scaffold: 'yes' as never })).toThrow(/scaffold must be a boolean/);
        expect(() => assertValidConfig({ includeInternal: 1 as never })).toThrow(/includeInternal must be a boolean/);
    });
});

describe('generateTargets', () => {
    it('emits the runtime and the aggregator at the configured output directory', async () => {
        const ctx = makeCtx();
        const plugin = createCSharpSdkPlugin({ baseDir: 'cssdk', namespace: 'Acme.Sdk', sdkName: 'AcmeSdk' }, ROOT_DIR);
        await plugin.generateTargets!(INPUTS, ctx);

        expect([...ctx.emitted.keys()].sort()).toEqual([
            'cssdk/AcmeSdk.cs',
            'cssdk/Clients/BillingClient.cs',
            'cssdk/Models/Billing.cs',
            'cssdk/Runtime/Converters.cs',
            'cssdk/Runtime/SdkRuntime.cs',
        ]);
        expect(ctx.emitted.get('cssdk/Runtime/SdkRuntime.cs')).toContain('namespace Acme.Sdk.Runtime;');
        expect(ctx.emitted.get('cssdk/Models/Billing.cs')).toContain('public sealed record Payment');
        expect(ctx.emitted.get('cssdk/Clients/BillingClient.cs')).toContain('public sealed class BillingClient(SdkHttp http)');
        expect(ctx.emitted.get('cssdk/AcmeSdk.cs')).toContain('public sealed class AcmeSdk : IDisposable');
        expect(ctx.emitted.get('cssdk/AcmeSdk.cs')).toContain('Billing = new BillingClient(Http);');
    });

    it('defaults the output directory, namespace, and aggregator name', async () => {
        const ctx = makeCtx();
        await createCSharpSdkPlugin({}, ROOT_DIR).generateTargets!(INPUTS, ctx);
        expect(ctx.emitted.has('csharp-sdk/Sdk.cs')).toBe(true);
        expect(ctx.emitted.get('csharp-sdk/Sdk.cs')).toContain('namespace ContractKit.Sdk;');
    });

    it('skips a client file whose operations are all internal, rather than emitting an empty class', async () => {
        const ctx = makeCtx();
        const internalOnly = {
            ...INPUTS,
            opRoots: [opRoot([opRoute('/x', [opOperation('get', { sdk: 'x' })], undefined, ['internal'])], 'contracts/admin.ck')],
        };
        await createCSharpSdkPlugin({ baseDir: 'cssdk', namespace: 'Acme.Sdk' }, ROOT_DIR).generateTargets!(internalOnly, ctx);
        expect([...ctx.emitted.keys()].some(k => k.includes('AdminClient'))).toBe(false);
    });

    it('emits the project file as user-owned only when scaffolding is asked for', async () => {
        const off = makeCtx();
        await createCSharpSdkPlugin({ baseDir: 'cssdk', sdkName: 'AcmeSdk' }, ROOT_DIR).generateTargets!(INPUTS, off);
        expect(off.emitted.has('cssdk/AcmeSdk.csproj')).toBe(false);

        const on = makeCtx();
        await createCSharpSdkPlugin({ baseDir: 'cssdk', sdkName: 'AcmeSdk', scaffold: true }, ROOT_DIR).generateTargets!(INPUTS, on);
        expect(on.emitted.get('cssdk/AcmeSdk.csproj')).toContain('<AssemblyName>AcmeSdk</AssemblyName>');
        // Write-once: the CLI must be told not to overwrite a file the user has since edited.
        expect(on.ifAbsent).toEqual(['cssdk/AcmeSdk.csproj']);
    });

    it('surfaces an invalid namespace as a build error rather than emitting broken C#', async () => {
        const ctx = makeCtx();
        const plugin = createCSharpSdkPlugin({ namespace: 'Acme.class.Sdk' }, ROOT_DIR);
        await expect(plugin.generateTargets!(INPUTS, ctx)).rejects.toThrow(/C# keyword 'class'/);
        expect(ctx.emitted.size).toBe(0);
    });
});
