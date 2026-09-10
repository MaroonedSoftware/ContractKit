import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/**
 * Decides which `.ck` files the workspace index loads. The startup walk asks `includesDir` before
 * descending into a directory, and file-watcher events ask `includesFile` before indexing a changed
 * file, so the initial scan and the live update path agree on the same set of files.
 */
export interface IndexScope {
    /** Whether the walk should descend into `dirPath`. */
    includesDir(dirPath: string): boolean;
    /** Whether the `.ck` file at `filePath` belongs in the index. */
    includesFile(filePath: string): boolean;
    /** Drop cached lookups. Call after a `.gitignore` or config file changes. */
    clear(): void;
}

/** Directories skipped whether or not a `.gitignore` names them. */
const ALWAYS_SKIPPED_DIRS = new Set(['node_modules', '.git']);

/**
 * An {@link IndexScope} that follows git's ignore rules: `.gitignore` files at every level from the
 * repository root down, plus `.git/info/exclude`. A deeper `.gitignore` overrides a shallower one,
 * and nothing inside an ignored directory can be re-included, matching `git status`. `node_modules`
 * and `.git` are always skipped, so a workspace without a `.gitignore` still avoids them.
 *
 * Rules above a workspace folder still apply when the folder sits inside a larger repository, but a
 * workspace folder itself is never excluded: opening a folder is an explicit request to see it.
 * Global excludes (`core.excludesFile`) are not read.
 */
export class GitignoreScope implements IndexScope {
    private readonly workspaceRoots: string[];
    /** Parsed `.gitignore` per directory; `undefined` when the directory has none. */
    private rulesByDir = new Map<string, Ignore | undefined>();
    /** Parsed `.git/info/exclude` per repository root; `undefined` when absent. */
    private excludeByGitRoot = new Map<string, Ignore | undefined>();
    /** Nearest ancestor-or-self holding a `.git` entry, per directory; `undefined` outside a repository. */
    private gitRootByDir = new Map<string, string | undefined>();
    /** Memoized {@link isExcluded} results for directories. */
    private excludedDirs = new Map<string, boolean>();
    /** Per workspace folder: whether the repository enclosing it ignores the folder itself. */
    private ignoredWorkspaceRoots = new Map<string, boolean>();

    constructor(workspaceRoots: readonly string[]) {
        this.workspaceRoots = workspaceRoots.map(root => path.resolve(root));
    }

    includesDir(dirPath: string): boolean {
        return !this.isExcluded(path.resolve(dirPath), true);
    }

    includesFile(filePath: string): boolean {
        return !this.isExcluded(path.resolve(filePath), false);
    }

    clear(): void {
        this.rulesByDir.clear();
        this.excludeByGitRoot.clear();
        this.gitRootByDir.clear();
        this.excludedDirs.clear();
        this.ignoredWorkspaceRoots.clear();
    }

    private isExcluded(entryPath: string, isDir: boolean): boolean {
        if (isDir) {
            const memo = this.excludedDirs.get(entryPath);
            if (memo !== undefined) return memo;
        }
        const result = this.computeExcluded(entryPath, isDir);
        if (isDir) this.excludedDirs.set(entryPath, result);
        return result;
    }

    private computeExcluded(entryPath: string, isDir: boolean): boolean {
        if (this.workspaceRoots.includes(entryPath)) return false;
        const parent = path.dirname(entryPath);
        const boundary = this.boundaryFor(parent);
        if (parent !== boundary && this.isExcluded(parent, true)) return true;
        if (isDir && ALWAYS_SKIPPED_DIRS.has(path.basename(entryPath))) return true;
        return this.matchesRules(entryPath, isDir, parent, boundary);
    }

    private matchesRules(entryPath: string, isDir: boolean, parent: string, boundary: string): boolean {
        const gitRoot = this.gitRootFor(parent);
        // A workspace folder that its enclosing repository ignores is treated as its own root.
        // Otherwise the repository's rule for the folder would exclude everything in it.
        if (gitRoot && gitRoot !== boundary && isInside(boundary, gitRoot) && this.isIgnoredByEnclosingRepo(boundary, gitRoot)) {
            return this.testRules(entryPath, isDir, parent, boundary, undefined);
        }
        return this.testRules(entryPath, isDir, parent, gitRoot ?? boundary, gitRoot);
    }

    private isIgnoredByEnclosingRepo(workspaceRoot: string, gitRoot: string): boolean {
        const memo = this.ignoredWorkspaceRoots.get(workspaceRoot);
        if (memo !== undefined) return memo;
        const result = this.testRules(workspaceRoot, true, path.dirname(workspaceRoot), gitRoot, gitRoot);
        this.ignoredWorkspaceRoots.set(workspaceRoot, result);
        return result;
    }

    /**
     * Test `entryPath` against every `.gitignore` from `fromDir` up to `top`, deepest first, then
     * against `gitRoot`'s `.git/info/exclude`. The first file with a decisive match (ignore, or a
     * negated re-include) wins, which is how git layers nested `.gitignore` files.
     */
    private testRules(entryPath: string, isDir: boolean, fromDir: string, top: string, gitRoot: string | undefined): boolean {
        const suffix = isDir ? '/' : '';
        let dir = fromDir;
        while (true) {
            const rules = this.rulesFor(dir);
            if (rules) {
                const result = rules.test(toPosix(path.relative(dir, entryPath)) + suffix);
                if (result.ignored) return true;
                if (result.unignored) return false;
            }
            if (dir === top) break;
            const next = path.dirname(dir);
            if (next === dir) break;
            dir = next;
        }
        if (gitRoot) {
            const exclude = this.excludeFor(gitRoot);
            if (exclude?.ignores(toPosix(path.relative(gitRoot, entryPath)) + suffix)) return true;
        }
        return false;
    }

    /**
     * The directory above which nothing is excluded for entries in `dir`: the deepest workspace folder
     * containing it, or its repository root (or `dir` itself) when it lies outside every workspace folder.
     */
    private boundaryFor(dir: string): string {
        let best: string | undefined;
        for (const root of this.workspaceRoots) {
            if (isInside(dir, root) && (!best || root.length > best.length)) best = root;
        }
        return best ?? this.gitRootFor(dir) ?? dir;
    }

    private gitRootFor(dir: string): string | undefined {
        if (this.gitRootByDir.has(dir)) return this.gitRootByDir.get(dir);
        let root: string | undefined;
        if (fs.existsSync(path.join(dir, '.git'))) {
            root = dir;
        } else {
            const parent = path.dirname(dir);
            root = parent === dir ? undefined : this.gitRootFor(parent);
        }
        this.gitRootByDir.set(dir, root);
        return root;
    }

    private rulesFor(dir: string): Ignore | undefined {
        if (this.rulesByDir.has(dir)) return this.rulesByDir.get(dir);
        const rules = readRules(path.join(dir, '.gitignore'));
        this.rulesByDir.set(dir, rules);
        return rules;
    }

    private excludeFor(gitRoot: string): Ignore | undefined {
        if (this.excludeByGitRoot.has(gitRoot)) return this.excludeByGitRoot.get(gitRoot);
        const rules = readRules(path.join(gitRoot, '.git', 'info', 'exclude'));
        this.excludeByGitRoot.set(gitRoot, rules);
        return rules;
    }
}

/** Parse an ignore file, or `undefined` when it is missing or unreadable. */
function readRules(filePath: string): Ignore | undefined {
    try {
        return ignore().add(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return undefined;
    }
}

/** True when `child` is `parent` or lies beneath it. */
export function isInside(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel));
}

function toPosix(p: string): string {
    return path.sep === '/' ? p : p.split(path.sep).join('/');
}
