import type { Plugin } from 'prettier';
import { builders } from 'prettier/doc';
import { parseCk, decomposeCk, DiagnosticCollector } from '@maroonedsoftware/contractkit';
import type { CkRootNode, DtoRootNode, OpRootNode } from '@maroonedsoftware/contractkit';
import { printDto } from './print-dto.js';
import { printOp } from './print-op.js';
import { printCk } from './print-ck.js';

const { hardline, join } = builders;

function toDoc(text: string) {
  const lines = text.trimEnd().split('\n');
  return join(hardline, lines);
}

const plugin: Plugin<CkRootNode | DtoRootNode | OpRootNode> = {
  languages: [
    {
      name: 'ContractDSL',
      parsers: ['contract-ck'],
      extensions: ['.ck'],
      vscodeLanguageIds: ['contract-ck'],
    },
    // Legacy support for .dto and .op extensions
    {
      name: 'ContractDTO',
      parsers: ['contract-ck'],
      extensions: ['.dto'],
      vscodeLanguageIds: ['contract-dto'],
    },
    {
      name: 'ContractOP',
      parsers: ['contract-ck'],
      extensions: ['.op'],
      vscodeLanguageIds: ['contract-op'],
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
