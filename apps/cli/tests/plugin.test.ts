import { DiagnosticCollector } from '@contractkit/core';
import { makePluginContext } from '../src/plugin.js';
import type { PluginEntry, ResolvedConfig } from '../src/config.js';

const entry: PluginEntry = { plugin: '@contractkit/plugin-typescript' };
const config = { rootDir: '/project' } as ResolvedConfig;

describe('makePluginContext', () => {
    describe('warn', () => {
        it('reports into the collector, prefixed with the plugin name', () => {
            const diag = new DiagnosticCollector();
            const ctx = makePluginContext(entry, config, false, '/cache', undefined, { diag, pluginName: 'typescript' });

            ctx.warn!('output path contains an unresolved {area}', '/project/contracts/users.ck', 12);

            expect(diag.getAll()).toEqual([
                {
                    file: '/project/contracts/users.ck',
                    line: 12,
                    message: '[plugin:typescript] output path contains an unresolved {area}',
                    severity: 'warning',
                    code: undefined,
                },
            ]);
        });

        it('warns rather than errors, so one misconfigured file does not cost the whole build', () => {
            // The CLI catches a `generateTargets` throw and continues to the next plugin, so a
            // plugin that threw over a single bad path template would lose all of its output.
            const diag = new DiagnosticCollector();
            const ctx = makePluginContext(entry, config, false, '/cache', undefined, { diag, pluginName: 'typescript' });

            ctx.warn!('something is off');

            expect(diag.hasErrors()).toBe(false);
        });

        it('defaults the location when the caller has none', () => {
            const diag = new DiagnosticCollector();
            const ctx = makePluginContext(entry, config, false, '/cache', undefined, { diag, pluginName: 'openapi' });

            ctx.warn!('no file in particular');

            expect(diag.getAll()[0]).toMatchObject({ file: '', line: 0 });
        });

        it('is undefined when no collector is supplied, so callers must use ctx.warn?.()', () => {
            // Harnesses construct PluginContext literals; the member is optional for their sake.
            const ctx = makePluginContext(entry, config, false, '/cache');
            expect(ctx.warn).toBeUndefined();
        });
    });
});
