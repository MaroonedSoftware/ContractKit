import { resolve } from 'node:path';
import { glob } from 'glob';

/** The glob call `resolveFiles` uses, injectable so tests can drive it without touching disk. */
export type GlobFn = (pattern: string, options: { absolute: true; cwd: string }) => Promise<string[]>;

/**
 * Compare two paths by UTF-16 code unit.
 *
 * Deliberately not `localeCompare`: that orders by the machine's locale, so the same contracts
 * would compile in a different order on a developer's laptop than in CI. Code-unit order is
 * arbitrary but identical everywhere.
 */
function byCodeUnit(a: string, b: string): number {
    if (a < b) return -1;
    return a > b ? 1 : 0;
}

/**
 * Expand the configured glob patterns into the list of `.ck` files to compile.
 *
 * Matches within one pattern are **sorted**. `glob` returns them in filesystem order, which varies
 * between runs, between machines, and as files are added or removed. That order reaches the
 * plugins as the order of `contractRoots` and `opRoots`, and every generator walks those in
 * sequence — so an unsorted list makes generated output churn between builds that had no source
 * change, turning a no-op rebuild into a large diff.
 *
 * Patterns keep the order they were configured in, and the first pattern to match a file wins:
 * a config listing types before operations is expressing an intent, and sorting across patterns
 * would silently discard it.
 */
export async function resolveFiles(patterns: string[], rootDir: string, globFn: GlobFn = glob as unknown as GlobFn): Promise<string[]> {
    const files: string[] = [];
    for (const pattern of patterns) {
        const matches = await globFn(pattern, { absolute: true, cwd: resolve(rootDir) });
        files.push(...[...matches].sort(byCodeUnit));
    }
    // `Set` keeps first-seen order, so a file matched by two patterns stays where the earlier
    // pattern put it.
    return [...new Set(files)];
}
