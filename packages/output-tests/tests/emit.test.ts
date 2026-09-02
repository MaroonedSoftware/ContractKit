import { describe, it, expect } from 'vitest';
import { buildOnce, formatDiagnostics, type PluginName } from './harness.js';

/**
 * One snapshot per emitted file, plus a `_files.txt` listing per plugin. The listing is the part
 * that catches a file being *lost* or *added*: a content snapshot for a file that stopped being
 * emitted would simply never be asserted.
 */

const { files, diagnostics } = await buildOnce();

const PLUGINS: PluginName[] = ['typescript', 'typescript-fastify', 'python', 'openapi', 'markdown', 'bruno', 'docs', 'docusaurus'];

describe('generated output', () => {
    it('records the diagnostics the fixtures produce', async () => {
        await expect(formatDiagnostics(diagnostics)).toMatchFileSnapshot('./__snapshots__/_diagnostics.txt');
    });

    for (const plugin of PLUGINS) {
        describe(plugin, () => {
            const emitted = files[plugin];
            const paths = [...emitted.keys()].sort();

            it('emits the expected set of files', async () => {
                await expect(paths.join('\n') + '\n').toMatchFileSnapshot(`./__snapshots__/${plugin}/_files.txt`);
            });

            for (const path of paths) {
                it(`emits ${path}`, async () => {
                    await expect(emitted.get(path)).toMatchFileSnapshot(`./__snapshots__/${plugin}/${path}`);
                });
            }
        });
    }
});
