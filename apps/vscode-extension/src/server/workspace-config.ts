import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const FALLBACK_BUILTINS_RE = /\\\{\{(\w+)\}\}|\{\{(\w+)\}\}/g;

interface RawConfig {
    rootDir?: string;
    plugins?: Record<string, { keys?: Record<string, string> } | unknown>;
}

/**
 * Resolves `contractkit.config.json` relative to each `.ck` file and merges every plugin
 * entry's `keys` into a `{{var}}` fallback map. Mirrors the CLI's `collectFallbackKeys` so
 * editor-time variable resolution matches compile-time behavior.
 *
 * Configs are NOT necessarily at the workspace root — `homegrown_v2` keeps it at
 * `apps/api/contractkit.config.json`, for example — so the lookup walks **up** from the
 * `.ck` file itself.
 *
 * Built-ins `{{rootDir}}` and `{{configDir}}` inside fallback values are resolved against
 * each config's location, with `~` in `rootDir` expanded against `$HOME`.
 */
export class WorkspaceConfigCache {
    /** Resolved keys per config-file path. */
    private byConfigPath = new Map<string, Record<string, string>>();
    /** Per-directory memoization of "the nearest config above this dir" lookups. */
    private dirToConfigPath = new Map<string, string | null>();

    /** Returns the merged fallback keys map for the given `.ck` file path. Empty when no config is reachable. */
    getKeysForFile(filePath: string): Record<string, string> {
        const configPath = this.findConfigForFile(filePath);
        if (!configPath) return {};
        const cached = this.byConfigPath.get(configPath);
        if (cached) return cached;
        const keys = this.loadKeysFromConfig(configPath);
        this.byConfigPath.set(configPath, keys);
        return keys;
    }

    /** Drop all cached entries — call when files change or the workspace is re-indexed. */
    clear(): void {
        this.byConfigPath.clear();
        this.dirToConfigPath.clear();
    }

    private findConfigForFile(filePath: string): string | undefined {
        let dir = path.dirname(filePath);
        for (let i = 0; i < 30; i++) {
            const memo = this.dirToConfigPath.get(dir);
            if (memo !== undefined) return memo ?? undefined;
            const candidate = path.join(dir, 'contractkit.config.json');
            if (fs.existsSync(candidate)) {
                this.dirToConfigPath.set(dir, candidate);
                return candidate;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                this.dirToConfigPath.set(dir, null);
                return undefined;
            }
            dir = parent;
        }
        return undefined;
    }

    private loadKeysFromConfig(configPath: string): Record<string, string> {
        let raw: RawConfig;
        try {
            raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RawConfig;
        } catch {
            return {};
        }
        const configDir = path.dirname(configPath);
        const rootDir = resolveRootDir(raw.rootDir, configDir);
        const builtins: Record<string, string> = { rootDir, configDir };
        const merged: Record<string, string> = {};
        if (!raw.plugins) return merged;
        for (const entry of Object.values(raw.plugins)) {
            const keys = (entry as { keys?: unknown })?.keys;
            if (!keys || typeof keys !== 'object' || Array.isArray(keys)) continue;
            for (const [name, value] of Object.entries(keys as Record<string, unknown>)) {
                if (typeof value !== 'string') continue;
                merged[name] = substituteBuiltins(value, builtins);
            }
        }
        return merged;
    }
}

function resolveRootDir(raw: string | undefined, configDir: string): string {
    let value = raw ?? '.';
    if (value.startsWith('~')) {
        value = os.homedir() + value.slice(1);
    }
    return path.resolve(configDir, value);
}

function substituteBuiltins(input: string, builtins: Record<string, string>): string {
    if (!input.includes('{{')) return input;
    return input.replace(FALLBACK_BUILTINS_RE, (_match, escapedName: string | undefined, varName: string | undefined) => {
        if (escapedName !== undefined) return `{{${escapedName}}}`;
        return builtins[varName!] ?? `{{${varName}}}`;
    });
}
