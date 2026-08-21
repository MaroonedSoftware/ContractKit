import type { CkRootNode } from '@contractkit/core';
import { printCk, printType } from '@contractkit/core';

/**
 * `.ck` serialization for the OpenAPI importer.
 *
 * This module used to carry its own printer. `.ck` had two of them — this one and the prettier
 * plugin's — and only the prettier copy was covered by the round-trip tests that the
 * `ck-grammar-change` checklist points at, so this one silently fell behind the grammar: it
 * ignored `hasBlock` and the `(documented)` response modifier, could not emit `mcp:`,
 * `plugins:`, `name:`, `override`, `format(output=)` or options-level header globals, and
 * emitted unparseable source for a regex containing `/` or an enum value containing both quote
 * styles.
 *
 * The printer now lives in `@contractkit/core` next to `parseCk`, and this module is a thin
 * adapter over it. A grammar change has one printer to update.
 */

/**
 * Options controlling how a {@link CkRootNode} is rendered to `.ck` source.
 *
 * @deprecated `includeComments` is a no-op and is kept only so existing callers still compile.
 * Comments are controlled upstream: `ConvertOptions.includeComments` gates every `description`
 * assignment in `schema-to-ast.ts` and `paths-to-ast.ts`, so when it is off the descriptions are
 * absent from the AST and there is nothing left for the printer to suppress.
 */
export interface SerializeOptions {
    /** No-op. See the deprecation note on {@link SerializeOptions}. */
    includeComments?: boolean;
}

/**
 * Serialize a `.ck` AST back to formatted `.ck` source text.
 *
 * Delegates to `printCk`, which prints from a `CkRootNode` alone — no Ohm CST and no original
 * source — so programmatically built nodes print correctly.
 */
export function astToCk(root: CkRootNode, _options: SerializeOptions = {}): string {
    return printCk(root);
}

/** Render a `ContractTypeNode` to its `.ck` source string. Re-exported from core. */
export const serializeType = printType;
