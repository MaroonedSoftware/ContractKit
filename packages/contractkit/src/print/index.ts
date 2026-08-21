/**
 * The `.ck` printer — the inverse of `parseCk`.
 *
 * Printing lives in core, next to the parser, because `.ck` must have exactly one printer.
 * It previously lived in the prettier plugin while `openapi-to-ck` carried a second,
 * hand-rolled one; only the prettier copy tracked grammar changes, so the two drifted until
 * the converter was emitting source that did not parse. Every producer of `.ck` text — the
 * formatter, the OpenAPI importer, anything future — goes through `printCk` so a grammar
 * change has one place to land.
 *
 * `printCk` takes a `CkRootNode` and nothing else: no Ohm CST, no original source. Nodes built
 * programmatically print correctly, because every layout-only field it consults
 * (`keyOrder`, `descriptionInline`, `inline`, `blankLineBefore`) has a documented default.
 */
export { printCk, DEFAULT_PRINT_WIDTH } from './print-ck.js';
export { printModelDecl } from './print-contract.js';
export { printRoute, printSecurity, groupComments, flushBlocks, type CommentBlock } from './print-operation.js';
export {
    printType,
    printField,
    printEnumExpanded,
    printInlineObjectExpanded,
    formatEnumValue,
    formatDefault,
    extractTrailingInlineObject,
    inlineComment,
    quoteString,
    isUnquotable,
    printRegex,
} from './print-type.js';
export { INDENT } from './indent.js';
