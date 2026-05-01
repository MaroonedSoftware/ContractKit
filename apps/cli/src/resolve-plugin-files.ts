import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { OpRootNode } from '@contractkit/core';
import type { DiagnosticCollector } from '@contractkit/core';

/**
 * Resolves plugin file references in operation `plugins` blocks.
 *
 * For each operation that declares `plugins: { name: "path.yml" }`, reads the
 * referenced file (resolved relative to the operation's source `.ck` file) and
 * stores the content in `op.pluginFiles[name]`. Emits a warning and skips if
 * the file is not found.
 */
export function resolvePluginFiles(roots: OpRootNode[], rootDir: string, diag: DiagnosticCollector): void {
    for (const root of roots) {
        const contractDir = dirname(resolve(rootDir, root.file));
        for (const route of root.routes) {
            for (const op of route.operations) {
                if (!op.plugins) continue;
                for (const [name, value] of Object.entries(op.plugins)) {
                    const absPath = resolve(contractDir, value);
                    if (!existsSync(absPath)) {
                        diag.warn(root.file, op.loc.line, `plugins.${name}: file not found: ${value}`);
                        continue;
                    }
                    op.pluginFiles ??= {};
                    op.pluginFiles[name] = readFileSync(absPath, 'utf-8');
                }
            }
        }
    }
}
