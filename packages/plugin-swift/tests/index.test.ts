import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@contractkit/core';
import { assertValidConfig, createSwiftSdkPlugin } from '../src/index.js';
import { contractRoot, field, model, opOperation, opResponse, opRoot, opRoute, scalarType } from './helpers.js';

const ROOT_DIR = '/project';

/** A `PluginContext` that captures `emitFile` in memory, keyed by rootDir-relative POSIX path. */
function makeCtx(): PluginContext & { emitted: Map<string, string>; ifAbsent: string[]; warnings: string[] } {
    const emitted = new Map<string, string>();
    const ifAbsent: string[] = [];
    const warnings: string[] = [];
    return {
        rootDir: ROOT_DIR,
        options: {},
        cacheEnabled: false,
        cacheDir: mkdtempSync(join(tmpdir(), 'ck-swift-')),
        emitFile: (outPath, content, opts) => {
            const key = relative(ROOT_DIR, outPath).split(sep).join('/');
            emitted.set(key, content);
            if (opts?.ifAbsent) ifAbsent.push(key);
        },
        warn: message => warnings.push(message),
        emitted,
        ifAbsent,
        warnings,
    };
}

describe('assertValidConfig', () => {
    it('accepts a valid config and an empty one', () => {
        expect(() => assertValidConfig({})).not.toThrow();
        expect(() => assertValidConfig({ moduleName: 'AcmeSdk', sdkName: 'Acme', scaffold: true })).not.toThrow();
    });

    it('rejects a name that is not a Swift identifier', () => {
        expect(() => assertValidConfig({ moduleName: '2Sdk' })).toThrow(/not a valid Swift identifier/);
        expect(() => assertValidConfig({ sdkName: 'Acme-Sdk' })).toThrow(/not a valid Swift identifier/);
    });

    it('rejects a name that is a reserved word or a type the generated code relies on', () => {
        expect(() => assertValidConfig({ sdkName: 'class' })).toThrow(/reserved word/);
        expect(() => assertValidConfig({ sdkName: 'SdkHttp' })).toThrow(/collides with a type/);
    });

    it('rejects a module and an SDK class with one name, which cannot both be referred to', () => {
        expect(() => assertValidConfig({ moduleName: 'Acme', sdkName: 'Acme' })).toThrow(/give the two different names/);
        // The same clash through the defaults.
        expect(() => assertValidConfig({ moduleName: 'Sdk' })).toThrow(/give the two different names/);
    });

    it('rejects non-boolean flags, which JSON config cannot be trusted to type', () => {
        expect(() => assertValidConfig({ scaffold: 'yes' as never })).toThrow(/scaffold must be a boolean/);
        expect(() => assertValidConfig({ includeInternal: 1 as never })).toThrow(/includeInternal must be a boolean/);
    });
});

describe('generateTargets', () => {
    const inputs = {
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

    it('emits models, clients, the runtime, and the aggregator under the module source root', async () => {
        const ctx = makeCtx();
        await createSwiftSdkPlugin({ baseDir: 'swiftsdk', moduleName: 'AcmeSdk', sdkName: 'Acme' }, ROOT_DIR).generateTargets!(inputs, ctx);

        expect([...ctx.emitted.keys()].sort()).toEqual([
            'swiftsdk/Sources/AcmeSdk/Acme.swift',
            'swiftsdk/Sources/AcmeSdk/Clients/BillingClient.swift',
            'swiftsdk/Sources/AcmeSdk/Models/BillingModels.swift',
            'swiftsdk/Sources/AcmeSdk/Runtime/JSONValue.swift',
            'swiftsdk/Sources/AcmeSdk/Runtime/Scalars.swift',
            'swiftsdk/Sources/AcmeSdk/Runtime/SdkRuntime.swift',
        ]);
        expect(ctx.emitted.get('swiftsdk/Sources/AcmeSdk/Models/BillingModels.swift')).toContain(
            'public struct Payment: Codable, Equatable, Sendable {',
        );
        expect(ctx.emitted.get('swiftsdk/Sources/AcmeSdk/Runtime/Scalars.swift')).toContain('public struct DecimalValue');
        expect(ctx.emitted.get('swiftsdk/Sources/AcmeSdk/Acme.swift')).toContain('self.billing = BillingClient(http: http)');
    });

    it('defaults the output directory, module, and aggregator name', async () => {
        const ctx = makeCtx();
        await createSwiftSdkPlugin({}, ROOT_DIR).generateTargets!(inputs, ctx);
        expect(ctx.emitted.has('swift-sdk/Sources/ContractKitSdk/Sdk.swift')).toBe(true);
    });

    it('skips a client file whose operations are all internal, rather than emitting an empty class', async () => {
        const ctx = makeCtx();
        const internalOnly = {
            ...inputs,
            opRoots: [opRoot([opRoute('/x', [opOperation('get', { sdk: 'x' })], undefined, ['internal'])], 'contracts/admin.ck')],
        };
        await createSwiftSdkPlugin({ baseDir: 'swiftsdk' }, ROOT_DIR).generateTargets!(internalOnly, ctx);
        expect([...ctx.emitted.keys()].some(k => k.includes('AdminClient'))).toBe(false);
    });

    it('emits Package.swift as a user-owned file only when scaffolding is asked for', async () => {
        const off = makeCtx();
        await createSwiftSdkPlugin({ baseDir: 'swiftsdk' }, ROOT_DIR).generateTargets!(inputs, off);
        expect(off.emitted.has('swiftsdk/Package.swift')).toBe(false);

        const on = makeCtx();
        await createSwiftSdkPlugin({ baseDir: 'swiftsdk', moduleName: 'AcmeSdk', scaffold: true }, ROOT_DIR).generateTargets!(inputs, on);
        expect(on.emitted.get('swiftsdk/Package.swift')).toContain('.library(name: "AcmeSdk", targets: ["AcmeSdk"]),');
        // Write-once: the CLI must be told not to overwrite a file the user has since edited.
        expect(on.ifAbsent).toEqual(['swiftsdk/Package.swift']);
    });

    it('surfaces an invalid config as a build error rather than emitting broken Swift', async () => {
        const ctx = makeCtx();
        await expect(createSwiftSdkPlugin({ sdkName: 'struct' }, ROOT_DIR).generateTargets!(inputs, ctx)).rejects.toThrow(/reserved word/);
        expect(ctx.emitted.size).toBe(0);
    });

    it('rejects a contract whose name would shadow a type the generated code relies on', async () => {
        const ctx = makeCtx();
        const clashing = { ...inputs, contractRoots: [contractRoot([model('Error', [field('message', scalarType('string'))])], 'contracts/e.ck')] };
        await expect(createSwiftSdkPlugin({}, ROOT_DIR).generateTargets!(clashing, ctx)).rejects.toThrow(/collides with a Swift or runtime type/);
        expect(ctx.emitted.size).toBe(0);
    });

    it('rejects a contract that collides with the SDK class or the module', async () => {
        const asSdk = { ...inputs, contractRoots: [contractRoot([model('Sdk', [field('v', scalarType('string'))])], 'contracts/s.ck')] };
        await expect(createSwiftSdkPlugin({}, ROOT_DIR).generateTargets!(asSdk, makeCtx())).rejects.toThrow(/same name as the SDK class/);

        const asModule = {
            ...inputs,
            contractRoots: [contractRoot([model('ContractKitSdk', [field('v', scalarType('string'))])], 'contracts/m.ck')],
        };
        await expect(createSwiftSdkPlugin({}, ROOT_DIR).generateTargets!(asModule, makeCtx())).rejects.toThrow(/same name as the Swift module/);
    });

    it('routes a generator warning through the plugin context, with the file it came from', async () => {
        const ctx = makeCtx();
        const withWarning = {
            ...inputs,
            contractRoots: [
                contractRoot(
                    [model('M', [field('meta', { kind: 'record', key: scalarType('int'), value: scalarType('string') })])],
                    'contracts/m.ck',
                ),
            ],
        };
        await createSwiftSdkPlugin({}, ROOT_DIR).generateTargets!(withWarning, ctx);
        expect(ctx.warnings.join('\n')).toMatch(/record key of type 'Int'/);
    });
});
