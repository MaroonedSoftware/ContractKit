import type { Plugin } from 'prettier';
import { builders } from 'prettier/doc';
import { parseCk, DiagnosticCollector } from '@maroonedsoftware/contractkit';
import type { CkRootNode } from '@maroonedsoftware/contractkit';
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
            print(path) {
                const node = path.node as CkRootNode;
                return toDoc(printCk(node));
            },
        },
    },
};

export default plugin;
