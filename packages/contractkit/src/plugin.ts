import type { CkRootNode, ContractRootNode, OpRootNode } from './ast.js';

export interface PluginContext {
    /** Absolute resolved rootDir from config. */
    rootDir: string;
    /** The plugin's own `options` from config (empty object if not set). */
    options: Record<string, unknown>;
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
     * Primary codegen hook — called once after ALL files are parsed and
     * cross-file state is resolved. Call ctx.emitFile() for each output.
     */
    generateTargets?: (
        inputs: {
            contractRoots: ContractRootNode[];
            opRoots: OpRootNode[];
            modelOutPaths: ReadonlyMap<string, string>;
            modelsWithInput: ReadonlySet<string>;
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
        /** One-line description shown in --help. */
        description: string;
        /** Handler — receives raw argv after the subcommand name. */
        run: (args: string[], ctx: CommandContext) => Promise<void>;
    };
}
