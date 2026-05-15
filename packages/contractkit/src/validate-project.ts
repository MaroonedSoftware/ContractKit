import { applyOptionsDefaults } from './apply-options-defaults.js';
import { applyVariableSubstitution } from './apply-variable-substitution.js';
import { decomposeCk } from './decompose.js';
import { DiagnosticCollector } from './diagnostics.js';
import { parseCk } from './parser.js';
import { validateInheritance } from './validate-inheritance.js';
import { validateOp } from './validate-operation.js';
import { validateRefs } from './validate-refs.js';
import type { CkRootNode, ContractRootNode, OpRootNode } from './ast.js';

/** A `.ck` source paired with the absolute path the parser should report in diagnostics. */
export interface ProjectFile {
    filePath: string;
    /** Pre-parsed AST, when the caller already has one (e.g. an LSP holding parses). Mutually exclusive with `source`. */
    ast?: CkRootNode;
    /** Raw source. Parsed by {@link validateProject} when `ast` is omitted. */
    source?: string;
}

/** Options accepted by {@link validateProject}. */
export interface ValidateProjectOptions {
    files: ProjectFile[];
    /** Fallback `{{key}}` substitutions applied workspace-wide. Passed through to {@link applyVariableSubstitution}. Ignored for any file that matches `getKeysForFile`. */
    fallbackKeys?: Record<string, string>;
    /**
     * Per-file fallback keys resolver, used when different files in the same project resolve
     * different `contractkit.config.json` files (e.g. an LSP serving a workspace with multiple
     * configs). Returning `undefined` falls back to `fallbackKeys`.
     */
    getKeysForFile?: (filePath: string) => Record<string, string> | undefined;
    /** Existing collector to append into. A fresh one is created when omitted. */
    diag?: DiagnosticCollector;
}

/** Output of {@link validateProject}. */
export interface ValidateProjectResult {
    /** Diagnostics collected across every phase. Same instance as `options.diag` when provided. */
    diag: DiagnosticCollector;
    /** Decomposed contract roots, one per file that produced any models. */
    contracts: ContractRootNode[];
    /** Decomposed op roots, one per file that produced any routes. */
    ops: OpRootNode[];
    /** Normalized (variable-substituted, options-defaulted) ASTs, one per input file. */
    asts: { filePath: string; ast: CkRootNode }[];
}

/**
 * Run the contractkit validation pipeline across a set of `.ck` files: parse
 * (when needed), apply options defaults, substitute `{{var}}` references,
 * decompose, then run cross-file ref/inheritance/operation validation.
 *
 * Designed as the single source of truth for both the CLI and the language
 * server so they enforce identical semantics. Plugin `validate`/`transform`
 * hooks are deliberately *not* invoked here — those live in the CLI because
 * they touch the filesystem and load arbitrary user code.
 *
 * Diagnostics are aggregated rather than thrown; callers inspect `diag` to
 * decide how to surface them (CLI prints + non-zero exit, LSP publishes
 * per-URI).
 */
export const validateProject = (options: ValidateProjectOptions): ValidateProjectResult => {
    const diag = options.diag ?? new DiagnosticCollector();
    const fallbackKeys = options.fallbackKeys ?? {};

    const contracts: ContractRootNode[] = [];
    const ops: OpRootNode[] = [];
    const asts: { filePath: string; ast: CkRootNode }[] = [];

    for (const file of options.files) {
        let ast: CkRootNode;
        if (file.ast) ast = file.ast;
        else if (file.source !== undefined) {
            try {
                ast = parseCk(file.source, file.filePath, diag);
            } catch {
                continue;
            }
        } else {
            diag.warn(file.filePath, 0, `validateProject: file entry has neither 'ast' nor 'source'`);
            continue;
        }

        applyOptionsDefaults(ast, diag);
        const keysForFile = options.getKeysForFile?.(file.filePath) ?? fallbackKeys;
        applyVariableSubstitution(ast, diag, keysForFile);
        asts.push({ filePath: file.filePath, ast });

        const { contract, op } = decomposeCk(ast);
        if (contract.models.length > 0) contracts.push(contract);
        if (op.routes.length > 0) ops.push(op);
    }

    // Cross-file: refs and inheritance only make sense once every file has contributed its models.
    validateRefs(contracts, ops, diag);
    validateInheritance(contracts, diag);
    for (const op of ops) {
        validateOp(op, diag);
    }

    return { diag, contracts, ops, asts };
};
