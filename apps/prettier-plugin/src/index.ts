import type { Plugin } from 'prettier';
import { builders } from 'prettier/doc';
import { parseDto, parseOp, DiagnosticCollector } from '@maroonedsoftware/contractkit';
import type { DtoRootNode, OpRootNode } from '@maroonedsoftware/contractkit';
import { printDto } from './print-dto.js';
import { printOp } from './print-op.js';

const { hardline, join } = builders;

function toDoc(text: string) {
  const lines = text.trimEnd().split('\n');
  return join(hardline, lines);
}

const plugin: Plugin<DtoRootNode | OpRootNode> = {
  languages: [
    {
      name: 'ContractDTO',
      parsers: ['contract-dto'],
      extensions: ['.dto'],
      vscodeLanguageIds: ['contract-dto'],
    },
    {
      name: 'ContractOP',
      parsers: ['contract-op'],
      extensions: ['.op'],
      vscodeLanguageIds: ['contract-op'],
    },
  ],

  parsers: {
    'contract-dto': {
      parse(text, _options) {
        const diag = new DiagnosticCollector();
        return parseDto(text, '<stdin>', diag);
      },
      astFormat: 'contract-dto',
      locStart: () => 0,
      locEnd: _node => 0,
    },
    'contract-op': {
      parse(text, _options) {
        const diag = new DiagnosticCollector();
        return parseOp(text, '<stdin>', diag);
      },
      astFormat: 'contract-op',
      locStart: () => 0,
      locEnd: _node => 0,
    },
  },

  printers: {
    'contract-dto': {
      print(path) {
        const node = path.node as DtoRootNode;
        return toDoc(printDto(node));
      },
    },
    'contract-op': {
      print(path) {
        const node = path.node as OpRootNode;
        return toDoc(printOp(node));
      },
    },
  },
};

export default plugin;
