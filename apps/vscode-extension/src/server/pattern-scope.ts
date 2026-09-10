import * as path from 'node:path';
import { Minimatch } from 'minimatch';
import { isInside, type IndexScope } from '../shared/index-scope.js';
import type { ConfigPatterns, WorkspaceConfigCache } from './workspace-config.js';

/** Match options that mirror how the CLI's `glob` call matches `patterns`. */
const MATCH_OPTIONS = {
    dot: false,
    nocase: process.platform === 'darwin' || process.platform === 'win32',
    nocomment: true,
    nonegate: true,
};

/**
 * Narrows another {@link IndexScope} to the files `contractkit.config.json` compiles. When a file's
 * nearest config lists `patterns` and the file sits inside that config's `rootDir`, the file is in
 * scope only if a pattern matches it, the way the CLI picks its inputs. Files with no such config,
 * and files outside its `rootDir` (a config whose `rootDir` points at another checkout), fall back
 * to `base` alone.
 *
 * `base` always applies first, so a pattern cannot pull in a gitignored or `node_modules` file.
 */
export class PatternScope implements IndexScope {
    /** Compiled matchers per config, keyed by the object the config cache hands out. */
    private matchers = new WeakMap<ConfigPatterns, Minimatch[]>();

    constructor(
        private readonly base: IndexScope,
        private readonly configs: WorkspaceConfigCache,
    ) {}

    includesDir(dirPath: string): boolean {
        return this.base.includesDir(dirPath);
    }

    includesFile(filePath: string): boolean {
        if (!this.base.includesFile(filePath)) return false;
        const absolute = path.resolve(filePath);
        const config = this.configs.getPatternsForFile(absolute);
        if (!config || !isInside(absolute, config.rootDir)) return true;
        const relative = toPosix(path.relative(config.rootDir, absolute));
        return this.matchersFor(config).some(m => m.match(path.isAbsolute(m.pattern) ? toPosix(absolute) : relative));
    }

    /** Clears `base`. The config cache is owned by the server and cleared separately. */
    clear(): void {
        this.base.clear();
    }

    private matchersFor(config: ConfigPatterns): Minimatch[] {
        let compiled = this.matchers.get(config);
        if (!compiled) {
            compiled = config.patterns.map(pattern => new Minimatch(normalizePattern(pattern), MATCH_OPTIONS));
            this.matchers.set(config, compiled);
        }
        return compiled;
    }
}

/** `glob` treats `./contracts/**` and `contracts/**` alike; minimatch does not, so drop the prefix. */
function normalizePattern(pattern: string): string {
    let p = pattern;
    while (p.startsWith('./')) p = p.slice(2);
    return p;
}

function toPosix(p: string): string {
    return path.sep === '/' ? p : p.split(path.sep).join('/');
}
