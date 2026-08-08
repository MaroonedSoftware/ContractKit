import type { Plugin } from 'prettier';
import { builders } from 'prettier/doc';
import { parseCk, DiagnosticCollector } from '@contractkit/core';
import type { CkRootNode } from '@contractkit/core';
import { printCk } from './print-ck.js';

const { hardline, join } = builders;

/**
 * Wrap printed source as a prettier doc.
 *
 * `printCk` already ends the file with a newline, but splitting on `\n` turns that into a
 * trailing empty segment, so the text is trimmed first and the final newline re-added as an
 * explicit `hardline`. Dropping it would leave the file without a terminating newline, which
 * fights every editor and lint rule that wants one.
 */
function toDoc(text: string) {
    const lines = text.trimEnd().split('\n');
    return [join(hardline, lines), hardline];
}

/**
 * Prettier plugin registering the `.ck` language, its parser, and its printer.
 *
 * The parser is `parseCk` and the printer is `printCk`, so formatting behaviour lives in
 * `@contractkit/core` and `print-ck.ts` rather than here — this module only adapts them to
 * prettier's interface. `tests/format-plugin.test.ts` covers that adapter layer, which a
 * printer-level test cannot reach.
 */
const plugin: Plugin<CkRootNode> = {
    languages: [
        {
            name: 'ContractDSL',
            parsers: ['contract-ck'],
            extensions: ['.ck'],
            vscodeLanguageIds: ['contract-ck'],
        },
    ],

    parsers: {
        'contract-ck': {
            parse(text, _options) {
                const diag = new DiagnosticCollector();
                return parseCk(text, '<stdin>', diag);
            },
            astFormat: 'contract-ck',
            locStart: () => 0,
            locEnd: _node => 0,
        },
    },

    printers: {
        'contract-ck': {
            print(path, options) {
                const node = path.node as CkRootNode;
                return toDoc(printCk(node, options.printWidth));
            },
        },
    },
};

export default plugin;
export { printCk, DEFAULT_PRINT_WIDTH } from './print-ck.js';
