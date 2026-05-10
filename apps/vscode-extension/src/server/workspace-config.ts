import * as fs from 'node:fs';
import * as path from 'node:path';

const FALLBACK_BUILTINS_RE = /\\\{\{(\w+)\}\}|\{\{(\w+)\}\}/g;

interface RawConfig {
    rootDir?: string;
    plugins?: Record<string, { keys?: Record<string, string> } | unknown>;
}

/**
 * Load `contractkit.config.json` from each workspace folder and merge every plugin entry's
 * `options.keys` into a single fallback map for `{{var}}` substitution. Mirrors the CLI's
 * `collectFallbackKeys` so editor-time variable resolution matches compile-time behavior.
 *
 * Built-ins `{{rootDir}}` and `{{configDir}}` inside fallback values are resolved against
 * each config's location.
 */
export function loadWorkspaceFallbackKeys(workspaceFolders: string[]): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const folder of workspaceFolders) {
        const configPath = findConfig(folder);
        if (!configPath) continue;
        let raw: RawConfig;
        try {
            raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RawConfig;
        } catch {
            continue;
        }
        const configDir = path.dirname(configPath);
        const rootDir = path.resolve(configDir, raw.rootDir ?? '.');
        const builtins: Record<string, string> = { rootDir, configDir };
        if (!raw.plugins) continue;
        for (const entry of Object.values(raw.plugins)) {
            const keys = (entry as { keys?: unknown })?.keys;
            if (!keys || typeof keys !== 'object' || Array.isArray(keys)) continue;
            for (const [name, value] of Object.entries(keys as Record<string, unknown>)) {
                if (typeof value !== 'string') continue;
                merged[name] = substituteBuiltins(value, builtins);
            }
        }
    }
    return merged;
}

function findConfig(startDir: string): string | undefined {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
        const candidate = path.join(dir, 'contractkit.config.json');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

function substituteBuiltins(input: string, builtins: Record<string, string>): string {
    if (!input.includes('{{')) return input;
    return input.replace(FALLBACK_BUILTINS_RE, (_match, escapedName: string | undefined, varName: string | undefined) => {
        if (escapedName !== undefined) return `{{${escapedName}}}`;
        return builtins[varName!] ?? `{{${varName}}}`;
    });
}
