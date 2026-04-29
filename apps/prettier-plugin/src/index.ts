import type { Plugin } from 'prettier';
import { builders } from 'prettier/doc';
import { parseCk, DiagnosticCollector } from '@contractkit/core';
import type { CkRootNode } from '@contractkit/core';
import { printCk } from './print-ck.js';

const { hardline, join } = builders;

function toDoc(text: string) {
    const lines = text.trimEnd().split('\n');
    return join(hardline, lines);
}

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
