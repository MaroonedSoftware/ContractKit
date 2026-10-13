import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@contractkit/core';
import { createCSharpSdkPlugin } from '../src/index.js';
import { contractRoot, field, model, opOperation, opResponse, opRoot, opRoute, scalarType } from './helpers.js';

/**
 * Server-Sent Events are rendered as a stream only by the TypeScript SDK. This one keeps reading the
 * response as text, as it did before `text/event-stream` had a category of its own, and says so.
 */
describe('text/event-stream responses', () => {
    const inputs = {
        contractRoots: [contractRoot([model('ChatEvent', [field('text', scalarType('string'))])], 'contracts/chat.ck')],
        opRoots: [
            opRoot(
                [
                    opRoute('/conversations/stream', [
                        opOperation('get', { sdk: 'streamConversation', responses: [opResponse(200, 'ChatEvent', 'text/event-stream')] }),
                    ]),
                ],
                'contracts/chat.ck',
            ),
        ],
        modelsWithInput: new Set<string>(),
        modelsWithOutput: new Set<string>(),
    };

    function makeCtx(): PluginContext & { emitted: Map<string, string>; warnings: string[] } {
        const emitted = new Map<string, string>();
        const warnings: string[] = [];
        return {
            rootDir: '/project',
            options: {},
            cacheEnabled: false,
            cacheDir: mkdtempSync(join(tmpdir(), 'ck-csharp-sse-')),
            emitFile: (outPath, content) => emitted.set(outPath, content),
            warn: message => warnings.push(message),
            emitted,
            warnings,
        };
    }

    it('warns that the C# SDK does not stream, and reads the body as a string', async () => {
        const ctx = makeCtx();
        await createCSharpSdkPlugin({ baseDir: 'sdk', namespace: 'Acme.Sdk', sdkName: 'AcmeSdk' }, '/project').generateTargets!(inputs, ctx);

        expect(ctx.warnings).toEqual([
            expect.stringContaining('GET /conversations/stream returns text/event-stream, which the C# SDK does not stream'),
        ]);
        const emitted = [...ctx.emitted.values()].join('\n');
        expect(emitted).toContain('Task<string> StreamConversationAsync(');
    });
});
