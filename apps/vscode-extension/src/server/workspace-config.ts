import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const FALLBACK_BUILTINS_RE = /\\\{\{(\w+)\}\}|\{\{(\w+)\}\}/g;

interface RawConfig {
    rootDir?: string;
    patterns?: unknown;
    plugins?: Record<string, { keys?: Record<string, string> } | unknown>;
}

const TS_PLUGIN_NAME = '@contractkit/plugin-typescript';

/** A config's `patterns`, with the absolute directory they are relative to. */
export interface ConfigPatterns {
    /** The config's resolved `rootDir`. */
    rootDir: string;
    /** Glob patterns for the `.ck` files the CLI compiles, as written in the config. Never empty. */
    patterns: string[];
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
    /** Resolved absolute TS-plugin `server.baseDir` per config-file path (`null` when none). */
    private serviceBaseDirByConfigPath = new Map<string, string | null>();
    /** Parsed `patterns` per config-file path; `undefined` when the config lists none. */
    private patternsByConfigPath = new Map<string, ConfigPatterns | undefined>();
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

    /**
     * Returns the absolute directory that anchors the generated server's `#`-subpath imports —
     * the TS plugin's resolved `server.baseDir` (`resolve(rootDir, baseDir)`). Used to resolve an
     * operation's `service: Class.method` reference to the real TypeScript source. `undefined` when
     * no config, no TS plugin, or no `server` sub-config is reachable from `filePath`.
     */
    getServiceBaseDirForFile(filePath: string): string | undefined {
        const configPath = this.findConfigForFile(filePath);
        if (!configPath) return undefined;
        const cached = this.serviceBaseDirByConfigPath.get(configPath);
        if (cached !== undefined) return cached ?? undefined;
        const baseDir = this.loadServiceBaseDir(configPath);
        this.serviceBaseDirByConfigPath.set(configPath, baseDir);
        return baseDir ?? undefined;
    }

    /**
     * Returns the `patterns` of the config nearest to `filePath`, resolved against its `rootDir`.
     * `undefined` when no config is reachable or it lists no patterns. The same object comes back
     * until {@link clear}, so callers can memoize work derived from it by identity.
     */
    getPatternsForFile(filePath: string): ConfigPatterns | undefined {
        const configPath = this.findConfigForFile(filePath);
        if (!configPath) return undefined;
        if (this.patternsByConfigPath.has(configPath)) return this.patternsByConfigPath.get(configPath);
        const patterns = this.loadPatterns(configPath);
        this.patternsByConfigPath.set(configPath, patterns);
        return patterns;
    }

    /** Drop all cached entries — call when files change or the workspace is re-indexed. */
    clear(): void {
        this.byConfigPath.clear();
        this.serviceBaseDirByConfigPath.clear();
        this.patternsByConfigPath.clear();
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

    private loadServiceBaseDir(configPath: string): string | null {
        let raw: RawConfig;
        try {
            raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RawConfig;
        } catch {
            return null;
        }
        const configDir = path.dirname(configPath);
        const rootDir = resolveRootDir(raw.rootDir, configDir);
        const tsPlugin = raw.plugins?.[TS_PLUGIN_NAME] as { server?: { baseDir?: unknown } } | undefined;
        const baseDir = tsPlugin?.server?.baseDir;
        if (typeof baseDir !== 'string') return null;
        return path.resolve(rootDir, baseDir);
    }

    private loadPatterns(configPath: string): ConfigPatterns | undefined {
        let raw: RawConfig;
        try {
            raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RawConfig;
        } catch {
            return undefined;
        }
        if (!Array.isArray(raw.patterns)) return undefined;
        const patterns = raw.patterns.filter((p): p is string => typeof p === 'string' && p.length > 0);
        if (patterns.length === 0) return undefined;
        return { rootDir: resolveRootDir(raw.rootDir, path.dirname(configPath)), patterns };
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
