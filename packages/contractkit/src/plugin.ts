import type { CkRootNode, ContractRootNode, OpRootNode, PluginValue } from './ast.js';

export interface PluginContext {
    /** Absolute resolved rootDir from config. */
    rootDir: string;
    /** The plugin's own `options` from config (empty object if not set). */
    options: Record<string, unknown>;
    /**
     * Whether plugin-internal caches should be honored. Set to `false` when the user
     * passes `--force` or when `cache: false` is configured. Plugins that maintain
     * their own incremental-build state (e.g. per-op manifests) should bypass it
     * when this is `false`. The CLI-level plugin cache is governed separately by
     * the plugin's `cacheKey`.
     */
    cacheEnabled: boolean;
    /**
     * Absolute path to the build-cache directory (default `<rootDir>/.contractkit/cache`,
     * configurable via `config.cache.dir`). Plugins that persist incremental-build state
     * across runs should write their manifest here so it co-locates with the rest of the
     * CLI's cache and is ignored by source control alongside it.
     */
    cacheDir: string;
    /** Register a file to be written to disk. Only available in generateTargets. */
    emitFile(outPath: string, content: string): void;
}

/** Context passed to a plugin's command handler. */
export interface CommandContext {
    /** Absolute resolved rootDir from config (best-effort; falls back to cwd). */
    rootDir: string;
    /** Directory containing contractkit.config.json (best-effort; falls back to cwd). */
    configDir: string;
}

export interface ContractKitPlugin {
    /** Human-readable name used in error messages. */
    name: string;

    /**
     * Declared cache key — used to fingerprint plugin outputs.
     * Increment when the plugin's output shape changes to bust the cache.
     * Example: 'grpc-v1'
     */
    cacheKey?: string;

    /**
     * Transform a parsed CkRootNode (unified AST, pre-decompose).
     * Called once per .ck file, before validateRefs/validateOp.
     * Return the mutated node, or unmutated node for pass-through.
     */
    transform?: (ast: CkRootNode, ctx: PluginContext) => Promise<CkRootNode>;

    /**
     * Validate a parsed CkRootNode. Throw an Error to fail compilation.
     * Called once per .ck file, before validateRefs/validateOp.
     */
    validate?: (ast: CkRootNode, ctx: PluginContext) => Promise<void>;

    /**
     * Validate an operation's `pluginExtensions[name]` entry, where `name` matches this
     * plugin's `name`. Called after `file://` URL resolution, once per matching entry.
     * Return `errors` to fail compilation, `warnings` to log without failing. Both arrays
     * are joined into single diagnostic messages prefixed with `plugins.<name>:`.
     */
    validateExtension?: (value: PluginValue) => { errors?: string[]; warnings?: string[] } | void;

    /**
     * Primary codegen hook — called once after ALL files are parsed and
     * cross-file state is resolved. Call ctx.emitFile() for each output.
     */
    generateTargets?: (
        inputs: {
            contractRoots: ContractRootNode[];
            opRoots: OpRootNode[];
            modelsWithInput: ReadonlySet<string>;
            modelsWithOutput: ReadonlySet<string>;
        },
        ctx: PluginContext,
    ) => Promise<void>;

    /**
     * Register a CLI subcommand exposed as `contractkit <name> [args...]`.
     * Built-in plugins (imported directly by the CLI) can use this to add
     * first-class subcommands without any config wiring.
     */
    command?: {
        /** The subcommand name, e.g. "import-openapi". */
        name: string;
        /** One-line description shown in the top-level --help listing. */
        description: string;
        /**
         * Full usage text shown when the subcommand is invoked with --help/-h.
         * Should include the usage line, argument descriptions, and option flags.
         */
        usage: string;
        /** Handler — receives raw argv after the subcommand name. */
        run: (args: string[], ctx: CommandContext) => Promise<void>;
    };
}
