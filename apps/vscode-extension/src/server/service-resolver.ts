import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolves an operation's `service: Class.method` reference to the real TypeScript
 * source location of the method.
 *
 * The service value in `options { services { ... } }` is a module specifier the generated
 * router imports at runtime — usually a `#`-subpath import pointing at a compiled `.js` file
 * (e.g. `#src/modules/pet/pet.service.js`). To jump to the source we:
 *
 *   1. Resolve the specifier: bare relative (`./`/`../`) against the package dir; `#`-imports
 *      via the package's `package.json` `imports` map; and any aliased prefix (`#`, `@`, …) via
 *      the nearest tsconfig's `compilerOptions.paths` — the common case when a project has no
 *      package.json `imports` map.
 *   2. Map the compiled `.js` extension back to a source extension (`.ts`, `.mts`, …).
 *   3. Scan the source file for the method declaration.
 *
 * `serviceBaseDir` is the absolute directory that owns the `package.json` — the TS plugin's
 * resolved `server.baseDir` (`resolve(rootDir, baseDir)`), where the generated routers live and
 * hence where the `#`-imports are anchored.
 */

/** A resolved source position, 0-based line/column, suitable for building an LSP `Range`. */
export interface SourcePosition {
    filePath: string;
    /** Zero-based line. */
    line: number;
    /** Zero-based column. */
    column: number;
    /** Length of the identifier at `column`, or 0 when we only resolved the file (not the method). */
    length: number;
}

/**
 * Resolve `service: Class.method` to a source position. Returns the method declaration when found,
 * else the top of the resolved file, else `null` when the file cannot be resolved.
 */
export function resolveServiceMethod(serviceBaseDir: string, moduleSpecifier: string, methodName: string): SourcePosition | null {
    const sourceFile = resolveServiceSourceFile(serviceBaseDir, moduleSpecifier);
    if (!sourceFile) return null;

    let text: string;
    try {
        text = fs.readFileSync(sourceFile, 'utf-8');
    } catch {
        return { filePath: sourceFile, line: 0, column: 0, length: 0 };
    }

    const method = findMethodDeclaration(text, methodName);
    if (method) return { filePath: sourceFile, ...method, length: methodName.length };
    return { filePath: sourceFile, line: 0, column: 0, length: 0 };
}

/** Extensions tried, in order, when mapping a compiled `.js` specifier back to source. */
const SOURCE_EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];

/**
 * Resolve a module specifier to an existing source file on disk, or `null`.
 * Tries, in order: bare relative (`./`, `../`) paths; `#`-subpath imports (via the package's
 * `package.json` `imports` map); and tsconfig `compilerOptions.paths` mappings (which cover
 * `#`, `@`, and bare-prefix aliases when there is no package.json `imports` map). The first
 * candidate whose source file exists on disk wins.
 */
export function resolveServiceSourceFile(serviceBaseDir: string, moduleSpecifier: string): string | null {
    if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
        return existingSourceFor(path.resolve(serviceBaseDir, moduleSpecifier));
    }

    const candidates: string[] = [];
    if (moduleSpecifier.startsWith('#')) {
        const subpath = resolveSubpathImport(serviceBaseDir, moduleSpecifier);
        if (subpath) candidates.push(subpath);
    }
    candidates.push(...resolveTsconfigPaths(serviceBaseDir, moduleSpecifier));

    for (const target of candidates) {
        const found = existingSourceFor(target);
        if (found) return found;
    }
    return null;
}

/** Try each source extension in place of the specifier's (compiled) extension; return the first that exists. */
function existingSourceFor(target: string): string | null {
    const ext = path.extname(target);
    const withoutExt = ext ? target.slice(0, -ext.length) : target;
    // Prefer a source-extension sibling; fall back to the literal target last.
    for (const candidateExt of SOURCE_EXTENSIONS) {
        const candidate = withoutExt + candidateExt;
        if (isFile(candidate)) return candidate;
    }
    if (isFile(target)) return target;
    return null;
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/**
 * Resolve a `#`-subpath import against `<serviceBaseDir>/package.json`'s `imports` map,
 * returning an absolute (unverified) target path, or `null`.
 */
function resolveSubpathImport(serviceBaseDir: string, specifier: string): string | null {
    const pkg = readPackageJson(serviceBaseDir);
    if (!pkg) return null;
    const imports = pkg.imports;
    if (!imports || typeof imports !== 'object') return null;

    // Exact (non-pattern) match wins outright.
    const exact = (imports as Record<string, unknown>)[specifier];
    if (exact !== undefined) {
        const target = pickConditionTarget(exact);
        if (target) return path.resolve(serviceBaseDir, target);
    }

    // Pattern match: the longest key prefix (before `*`) that also matches the suffix.
    let best: { prefix: string; target: string; wildcard: string } | null = null;
    for (const [key, value] of Object.entries(imports as Record<string, unknown>)) {
        const star = key.indexOf('*');
        if (star === -1) continue;
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
        if (specifier.length < prefix.length + suffix.length) continue;
        const target = pickConditionTarget(value);
        if (!target) continue;
        const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
        if (!best || prefix.length > best.prefix.length) best = { prefix, target, wildcard };
    }
    if (!best) return null;

    const resolvedTarget = best.target.replace('*', best.wildcard);
    return path.resolve(serviceBaseDir, resolvedTarget);
}

/**
 * A `package.json` `imports` target is either a string or a conditional-exports object
 * (`{ import, require, node, default }`). Return the first usable string target.
 */
function pickConditionTarget(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const condition of ['import', 'node', 'default', 'require']) {
            const inner = (value as Record<string, unknown>)[condition];
            const resolved = pickConditionTarget(inner);
            if (resolved) return resolved;
        }
    }
    return null;
}

function readPackageJson(dir: string): { imports?: unknown } | null {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { imports?: unknown };
    } catch {
        return null;
    }
}

/**
 * Resolve a module specifier against the nearest tsconfig's `compilerOptions.paths`, returning
 * absolute (unverified) target candidates. Path targets resolve against `baseUrl` (or, absent
 * `baseUrl`, the directory of the tsconfig that declares `paths` — matching TypeScript 5+).
 * `extends` is followed to inherit missing `baseUrl`/`paths`.
 */
function resolveTsconfigPaths(startDir: string, specifier: string): string[] {
    const configPath = findTsconfig(startDir);
    if (!configPath) return [];
    const resolved = loadTsconfigPathMappings(configPath, new Set());
    if (!resolved) return [];
    const { pathsBase, paths } = resolved;

    // Exact (non-pattern) key match wins outright.
    const exact = paths[specifier];
    if (exact) return exact.map(t => path.resolve(pathsBase, t));

    // Pattern match: longest matching prefix (before `*`) that also matches the suffix.
    let best: { prefixLen: number; targets: string[]; wildcard: string } | null = null;
    for (const [key, targets] of Object.entries(paths)) {
        const star = key.indexOf('*');
        if (star === -1) continue;
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
        if (specifier.length < prefix.length + suffix.length) continue;
        if (!best || prefix.length > best.prefixLen) {
            best = { prefixLen: prefix.length, targets, wildcard: specifier.slice(prefix.length, specifier.length - suffix.length) };
        }
    }
    if (!best) return [];
    return best.targets.map(t => path.resolve(pathsBase, t.replace('*', best!.wildcard)));
}

interface TsconfigPathMappings {
    /** Absolute directory that path targets resolve against. */
    pathsBase: string;
    paths: Record<string, string[]>;
}

/**
 * Walk a tsconfig `extends` chain to collect the effective `baseUrl` and `paths`. The nearest
 * config's values win; parents fill only what the child omits. `seen` guards against cyclic
 * `extends`.
 */
function loadTsconfigPathMappings(configPath: string, seen: Set<string>): TsconfigPathMappings | null {
    const absPath = path.resolve(configPath);
    if (seen.has(absPath)) return null;
    seen.add(absPath);

    const config = readJsonc(absPath);
    if (!config) return null;
    const configDir = path.dirname(absPath);
    const compilerOptions = (config.compilerOptions ?? {}) as { baseUrl?: unknown; paths?: unknown };

    let paths: Record<string, string[]> | undefined;
    let pathsBase: string | undefined;
    if (compilerOptions.paths && typeof compilerOptions.paths === 'object' && !Array.isArray(compilerOptions.paths)) {
        paths = normalizePathsMap(compilerOptions.paths as Record<string, unknown>);
        // Without `baseUrl`, TS 5+ resolves path targets against the tsconfig's own directory.
        pathsBase = typeof compilerOptions.baseUrl === 'string' ? path.resolve(configDir, compilerOptions.baseUrl) : configDir;
    }

    if (paths && pathsBase) return { pathsBase, paths };

    // Not found here — inherit from the extended config(s).
    const extendsValue = config.extends;
    for (const parentPath of resolveExtends(extendsValue, configDir)) {
        const inherited = loadTsconfigPathMappings(parentPath, seen);
        if (inherited) return inherited;
    }
    return null;
}

/** Coerce a raw `paths` map (values may be string or string[]) into `Record<string, string[]>`. */
function normalizePathsMap(raw: Record<string, unknown>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') out[key] = [value];
        else if (Array.isArray(value)) out[key] = value.filter((v): v is string => typeof v === 'string');
    }
    return out;
}

/** Resolve a tsconfig `extends` value (string or array) to candidate absolute config paths. */
function resolveExtends(extendsValue: unknown, configDir: string): string[] {
    const values = typeof extendsValue === 'string' ? [extendsValue] : Array.isArray(extendsValue) ? extendsValue : [];
    const out: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') continue;
        if (value.startsWith('./') || value.startsWith('../') || path.isAbsolute(value)) {
            const base = path.resolve(configDir, value);
            out.push(base.endsWith('.json') ? base : `${base}.json`);
        }
        // Bare package extends (e.g. `@tsconfig/node20`) are skipped: base configs rarely define
        // the project's own path aliases, and resolving them through node_modules is out of scope.
    }
    return out;
}

/** Walk up from `startDir` to the nearest `tsconfig.json`, or `null`. */
function findTsconfig(startDir: string): string | null {
    let dir = startDir;
    for (let i = 0; i < 30; i++) {
        const candidate = path.join(dir, 'tsconfig.json');
        if (isFile(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/** Parse a JSONC file (tsconfig allows comments and trailing commas), or `null` on failure. */
function readJsonc(filePath: string): { compilerOptions?: unknown; extends?: unknown } | null {
    try {
        return JSON.parse(stripJsonc(fs.readFileSync(filePath, 'utf-8'))) as { compilerOptions?: unknown; extends?: unknown };
    } catch {
        return null;
    }
}

/** Strip `//` and block comments and trailing commas from JSONC, preserving string contents. */
function stripJsonc(input: string): string {
    let out = '';
    let i = 0;
    let inString = false;
    while (i < input.length) {
        const ch = input[i]!;
        if (inString) {
            out += ch;
            if (ch === '\\' && i + 1 < input.length) {
                out += input[i + 1];
                i += 2;
                continue;
            }
            if (ch === '"') inString = false;
            i++;
            continue;
        }
        if (ch === '"') {
            inString = true;
            out += ch;
            i++;
            continue;
        }
        if (ch === '/' && input[i + 1] === '/') {
            while (i < input.length && input[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && input[i + 1] === '*') {
            i += 2;
            while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        out += ch;
        i++;
    }
    // Remove trailing commas before `}` or `]`.
    return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Find the declaration of `methodName` in TypeScript source. Recognizes class methods
 * (`foo(`, `async foo(`, `foo<T>(`) and property/arrow forms (`foo:`, `foo =`). Ignores call
 * sites like `this.foo(` / `svc.foo(` by rejecting a preceding `.`. Returns the first match.
 */
function findMethodDeclaration(text: string, methodName: string): { line: number; column: number } | null {
    const lines = text.split('\n');
    const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Not preceded by `.` or another identifier char; followed by `(`, `<`, `:`, or `=`.
    const re = new RegExp(`(^|[^.\\w$])(${escaped})\\s*[(<:=]`);
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]!);
        if (m) return { line: i, column: m.index + m[1]!.length };
    }
    return null;
}
