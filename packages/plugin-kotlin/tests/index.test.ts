import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@contractkit/core';
import { assertValidConfig, createKotlinSdkPlugin } from '../src/index.js';
import { contractRoot, field, model, scalarType } from './helpers.js';

const ROOT_DIR = '/project';

/** A `PluginContext` that captures `emitFile` in memory, keyed by rootDir-relative POSIX path. */
function makeCtx(): PluginContext & { emitted: Map<string, string> } {
    const emitted = new Map<string, string>();
    return {
        rootDir: ROOT_DIR,
        options: {},
        cacheEnabled: false,
        cacheDir: mkdtempSync(join(tmpdir(), 'ck-kotlin-')),
        emitFile: (outPath, content) => emitted.set(relative(ROOT_DIR, outPath).split(sep).join('/'), content),
        emitted,
    };
}

describe('assertValidConfig', () => {
    it('accepts a valid config and an empty one', () => {
        expect(() => assertValidConfig({})).not.toThrow();
        expect(() => assertValidConfig({ packageName: 'com.acme.sdk', sdkName: 'AcmeSdk', scaffold: true })).not.toThrow();
    });

    it('rejects a package segment that is not an identifier', () => {
        expect(() => assertValidConfig({ packageName: 'com.1bad' })).toThrow(/not a valid Kotlin package/);
        expect(() => assertValidConfig({ packageName: 'com..acme' })).toThrow(/not a valid Kotlin package/);
        expect(() => assertValidConfig({ packageName: 'com/acme' })).toThrow(/not a valid Kotlin package/);
    });

    it('rejects a package segment that is a Kotlin keyword', () => {
        expect(() => assertValidConfig({ packageName: 'com.object.sdk' })).toThrow(/contains the Kotlin keyword 'object'/);
    });

    it('rejects an sdkName that is not a class name', () => {
        expect(() => assertValidConfig({ sdkName: '2Sdk' })).toThrow(/not a valid Kotlin class name/);
    });

    it('rejects non-boolean flags, which JSON config cannot be trusted to type', () => {
        expect(() => assertValidConfig({ scaffold: 'yes' as never })).toThrow(/scaffold must be a boolean/);
        expect(() => assertValidConfig({ includeInternal: 1 as never })).toThrow(/includeInternal must be a boolean/);
    });
});

describe('generateTargets', () => {
    const inputs = {
        contractRoots: [contractRoot([model('Payment', [field('id', scalarType('uuid'))])], 'contracts/billing.ck')],
        opRoots: [],
        modelsWithInput: new Set<string>(),
        modelsWithOutput: new Set<string>(),
    };

    it('emits models, the runtime, and the aggregator at the configured package path', async () => {
        const ctx = makeCtx();
        const plugin = createKotlinSdkPlugin({ baseDir: 'ktsdk', packageName: 'com.acme.sdk', sdkName: 'AcmeSdk' }, ROOT_DIR);
        await plugin.generateTargets!(inputs, ctx);

        expect([...ctx.emitted.keys()].sort()).toEqual([
            'ktsdk/src/commonMain/kotlin/com/acme/sdk/AcmeSdk.kt',
            'ktsdk/src/commonMain/kotlin/com/acme/sdk/models/BillingModels.kt',
            'ktsdk/src/commonMain/kotlin/com/acme/sdk/runtime/Serializers.kt',
        ]);
        expect(ctx.emitted.get('ktsdk/src/commonMain/kotlin/com/acme/sdk/models/BillingModels.kt')).toContain('data class Payment(');
        expect(ctx.emitted.get('ktsdk/src/commonMain/kotlin/com/acme/sdk/runtime/Serializers.kt')).toContain('value class Decimal');
    });

    it('defaults the output directory, package, and aggregator name', async () => {
        const ctx = makeCtx();
        await createKotlinSdkPlugin({}, ROOT_DIR).generateTargets!(inputs, ctx);
        expect(ctx.emitted.has('kotlin-sdk/src/commonMain/kotlin/contractkit/sdk/Sdk.kt')).toBe(true);
    });

    it('surfaces an invalid package name as a build error rather than emitting broken Kotlin', async () => {
        const ctx = makeCtx();
        const plugin = createKotlinSdkPlugin({ packageName: 'com.class.sdk' }, ROOT_DIR);
        await expect(plugin.generateTargets!(inputs, ctx)).rejects.toThrow(/Kotlin keyword 'class'/);
        expect(ctx.emitted.size).toBe(0);
    });
});
