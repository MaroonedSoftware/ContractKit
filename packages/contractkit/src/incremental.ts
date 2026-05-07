import { createHash } from 'node:crypto';

/**
 * Schema version for the on-disk manifest. Bumped if the manifest shape itself changes.
 * Plugin codegen changes are tracked separately via `codegenVersion`.
 */
export const INCREMENTAL_MANIFEST_VERSION = 2;

/** A single output file produced by a plugin: relative path within the plugin's output dir + content. */
export interface IncrementalOutputFile {
    relativePath: string;
    content: string;
}

/** Cache record for one plugin "unit" — the smallest thing a plugin can decide to regenerate or reuse. */
export interface IncrementalUnitRecord {
    /** Hash covering every input that affects this unit's output. */
    fingerprint: string;
    /** Relative paths this unit emitted last time. Used to verify on-disk presence on cache hit, and to detect file removals. */
    files: string[];
}

/**
 * Persistent on-disk record describing what a plugin produced last run. Plugins write
 * one of these per output dir. The `version` and `codegenVersion` fields together
 * decide whether the cache can be honored at all on the current run.
 */
export interface IncrementalManifest {
    version: number;
    /** Plugin-defined version string. Bump in the plugin code to force a full regen across all units. */
    codegenVersion: string;
    /** Every relative path the plugin tracks (units' files plus global files plus the manifest itself). Used to compute deletions on the next run. */
    files: string[];
    /** Per-unit cache records keyed by stable unit ID. */
    units: Record<string, IncrementalUnitRecord>;
}

/** A cacheable codegen unit — a stable key + the inputs to fingerprint + a deferred renderer that's only invoked on cache miss. */
export interface IncrementalUnit {
    /** Stable ID across runs (e.g. `<file>::<METHOD> <path>` for ops, `<file>` for per-file outputs). Renaming the source breaks the key, which is the correct behavior — old files get cleaned up, new ones are emitted. */
    key: string;
    /** Pre-computed fingerprint covering every input that affects this unit's output. The caller is responsible for hashing in any cross-unit inputs (e.g. transitively-referenced models, plugin config). */
    fingerprint: string;
    /** Renders the unit's output(s). Only called on cache miss. May produce zero, one, or many files (e.g. paired router + types files). */
    render: () => IncrementalOutputFile[];
}

/** What {@link runIncrementalCodegen} produces — output files the caller must write, the new manifest the caller must persist (separately, typically in the build cache directory), paths that should be deleted, and a count of skipped units (useful for logging). */
export interface IncrementalResult {
    /** Output files the caller should write (changed/new units' files plus global files). The manifest is **not** included — persist it separately via {@link IncrementalResult.manifest}. */
    filesToWrite: IncrementalOutputFile[];
    /** New manifest the caller should persist (typically as JSON to a path under the build cache directory). */
    manifest: IncrementalManifest;
    /** Relative paths from the prior run that no longer appear in the new run. The caller should delete these from disk. */
    deletedPaths: string[];
    /** Number of units whose codegen was skipped because their fingerprint matched. */
    skippedUnitCount: number;
}

/** Construct a no-op manifest, used when no prior run exists or when the cache is being intentionally bypassed (`--force`, `cacheEnabled=false`). */
export function emptyIncrementalManifest(codegenVersion: string): IncrementalManifest {
    return { version: INCREMENTAL_MANIFEST_VERSION, codegenVersion, files: [], units: {} };
}

/**
 * Parse a previously-persisted manifest file. Returns an empty manifest on any
 * shape error (malformed JSON, wrong version, missing fields). Stale files
 * never block a build: the worst case is a full regen.
 */
export function parseIncrementalManifest(content: string): IncrementalManifest {
    try {
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || parsed.version !== INCREMENTAL_MANIFEST_VERSION) {
            return emptyIncrementalManifest('');
        }
        const codegenVersion = typeof parsed.codegenVersion === 'string' ? parsed.codegenVersion : '';
        const files = Array.isArray(parsed.files) && parsed.files.every((f: unknown) => typeof f === 'string') ? (parsed.files as string[]) : [];
        const units: Record<string, IncrementalUnitRecord> = {};
        if (parsed.units && typeof parsed.units === 'object' && !Array.isArray(parsed.units)) {
            for (const [key, raw] of Object.entries(parsed.units as Record<string, unknown>)) {
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as Record<string, unknown>;
                const fp = entry['fingerprint'];
                const fs = entry['files'];
                if (typeof fp !== 'string') continue;
                if (!Array.isArray(fs) || !fs.every(p => typeof p === 'string')) continue;
                units[key] = { fingerprint: fp, files: fs as string[] };
            }
        }
        return { version: INCREMENTAL_MANIFEST_VERSION, codegenVersion, files, units };
    } catch {
        return emptyIncrementalManifest('');
    }
}

/** sha256 hex of `value` after stable JSON serialization. Two payloads with the same content always hash the same. */
export function hashFingerprint(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * JSON.stringify variant that sorts object keys recursively, so structurally
 * equivalent values always serialize identically.
 *
 * Handles `bigint` values (which native `JSON.stringify` rejects) by emitting
 * them as a tagged string `"<bigint:VALUE>"`. Tagging — rather than coercing to
 * a plain string or number — keeps `1n` and `"1"` distinguishable in fingerprints.
 * `undefined` is normalized to `null` (stable) instead of being dropped (which
 * would make `{a: undefined}` and `{}` collide).
 */
export function stableStringify(value: unknown): string {
    if (value === undefined) return 'null';
    if (typeof value === 'bigint') return JSON.stringify(`<bigint:${value.toString()}>`);
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}

/**
 * Run incremental codegen.
 *
 * For each unit, compares its current `fingerprint` against the prior manifest's
 * record. On match (and provided every previously-emitted file is still on disk)
 * the unit's `render()` is skipped and its prior output paths carry forward.
 * On mismatch (or a missing file, or a `codegenVersion` bump) the unit re-renders
 * and its files land in `filesToWrite`.
 *
 * Global files always land in `filesToWrite` — they're for outputs that always
 * regenerate (aggregators, barrels, constants).
 *
 * The caller is responsible for:
 * 1. Writing every `filesToWrite` entry to disk.
 * 2. Deleting every `deletedPaths` entry from disk.
 * 3. Persisting `manifest` to its own location (typically `<cacheDir>/<plugin>-manifest.json`).
 *    The manifest is NOT in `filesToWrite` — it's deliberately separate so plugins can
 *    place build state under the CLI cache dir rather than mixing it with output files.
 */
export function runIncrementalCodegen(args: {
    codegenVersion: string;
    prevManifest: IncrementalManifest;
    /** Files always written, regardless of cache state — typically aggregators or constants. */
    globalFiles: IncrementalOutputFile[];
    /** Cacheable units, in deterministic order. */
    units: IncrementalUnit[];
    /** Returns `true` if the given relative path currently exists on disk. Used to invalidate cache entries when a previously-emitted file was deleted. */
    fileExists: (relativePath: string) => boolean;
}): IncrementalResult {
    const { codegenVersion, prevManifest, globalFiles, units, fileExists } = args;
    const filesToWrite: IncrementalOutputFile[] = [];
    const trackedPaths = new Set<string>();
    const newUnits: Record<string, IncrementalUnitRecord> = {};
    let skippedUnitCount = 0;

    const cacheUsable = prevManifest.version === INCREMENTAL_MANIFEST_VERSION && prevManifest.codegenVersion === codegenVersion;

    for (const file of globalFiles) {
        filesToWrite.push(file);
        trackedPaths.add(file.relativePath);
    }

    for (const unit of units) {
        const prev = cacheUsable ? prevManifest.units[unit.key] : undefined;
        const cacheHit =
            prev !== undefined && prev.fingerprint === unit.fingerprint && prev.files.length > 0 && prev.files.every(p => fileExists(p));

        if (cacheHit) {
            newUnits[unit.key] = { fingerprint: unit.fingerprint, files: prev!.files };
            for (const p of prev!.files) trackedPaths.add(p);
            skippedUnitCount++;
            continue;
        }

        const rendered = unit.render();
        const renderedPaths: string[] = [];
        for (const file of rendered) {
            filesToWrite.push(file);
            trackedPaths.add(file.relativePath);
            renderedPaths.push(file.relativePath);
        }
        newUnits[unit.key] = { fingerprint: unit.fingerprint, files: renderedPaths };
    }

    const sortedFiles = [...trackedPaths].sort();
    const manifest: IncrementalManifest = {
        version: INCREMENTAL_MANIFEST_VERSION,
        codegenVersion,
        files: sortedFiles,
        units: newUnits,
    };

    const deletedPaths = prevManifest.files.filter(p => !trackedPaths.has(p));
    return { filesToWrite, manifest, deletedPaths, skippedUnitCount };
}

/** Serialize a manifest to the JSON form persisted on disk. */
export function serializeIncrementalManifest(manifest: IncrementalManifest): string {
    return JSON.stringify(manifest, null, 2) + '\n';
}
