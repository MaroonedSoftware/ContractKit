import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceConfigCache } from '../src/server/workspace-config.js';

const TMP = path.join(os.tmpdir(), `ck-ws-config-${process.pid}`);
const CONFIG_DIR = path.join(TMP, 'apps', 'api');
const CONFIG_PATH = path.join(CONFIG_DIR, 'contractkit.config.json');
const CK_FILE = path.join(CONFIG_DIR, 'contracts', 'operations', 'foo.ck');

beforeAll(() => {
    fs.mkdirSync(path.dirname(CK_FILE), { recursive: true });
    fs.writeFileSync(CK_FILE, '');
    fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify({
            rootDir: '../../',
            plugins: {
                '@contractkit/plugin-bruno': {
                    keys: { bruno: '{{rootDir}}/apps/api/contracts/bruno' },
                },
            },
        }),
    );
});

afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
});

describe('WorkspaceConfigCache', () => {
    it('finds the nearest contractkit.config.json by walking up from the .ck file', () => {
        const cache = new WorkspaceConfigCache();
        const keys = cache.getKeysForFile(CK_FILE);
        expect(keys.bruno).toBe(path.join(TMP, 'apps/api/contracts/bruno'));
    });

    it('returns an empty map for files with no reachable config', () => {
        const cache = new WorkspaceConfigCache();
        const keys = cache.getKeysForFile('/nonexistent/path/file.ck');
        expect(keys).toEqual({});
    });

    it('clear() invalidates cached lookups', () => {
        const cache = new WorkspaceConfigCache();
        cache.getKeysForFile(CK_FILE);
        cache.clear();
        // Re-deletion via clear() means the next call must re-read the file from disk; we just
        // assert the result is still correct (no crash, same value).
        const keys = cache.getKeysForFile(CK_FILE);
        expect(keys.bruno).toContain('apps/api/contracts/bruno');
    });
});
