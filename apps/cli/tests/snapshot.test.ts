import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseDto } from '../src/parser-dto.js';
import { parseOp } from '../src/parser-op.js';
import { generateDto } from '../src/codegen-dto.js';
import { generateOp } from '../src/codegen-op.js';
import { DiagnosticCollector } from '../src/diagnostics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, '../../../contracts');

function compileDtoFile(relPath: string): string {
  const filePath = resolve(CONTRACTS_DIR, relPath);
  const source = readFileSync(filePath, 'utf-8');
  const diag = new DiagnosticCollector();
  const ast = parseDto(source, filePath, diag);
  expect(diag.hasErrors()).toBe(false);
  return generateDto(ast);
}

function compileOpFile(relPath: string): string {
  const filePath = resolve(CONTRACTS_DIR, relPath);
  const source = readFileSync(filePath, 'utf-8');
  const diag = new DiagnosticCollector();
  const ast = parseOp(source, filePath, diag);
  expect(diag.hasErrors()).toBe(false);
  return generateOp(ast);
}

describe('DTO snapshot tests', () => {
  it('pagination.dto matches snapshot', () => {
    const output = compileDtoFile('types/shared/pagination.dto');
    expect(output).toMatchSnapshot();
  });

  it('ledger.account.dto matches snapshot', () => {
    const output = compileDtoFile('types/modules/ledger/ledger.account.dto');
    expect(output).toMatchSnapshot();
  });

  it('counterparty.dto matches snapshot', () => {
    const output = compileDtoFile('types/modules/transfers/counterparty.dto');
    expect(output).toMatchSnapshot();
  });
});

describe('OP snapshot tests', () => {
  it('ledger.op matches snapshot', () => {
    const output = compileOpFile('operations/ledger.op');
    expect(output).toMatchSnapshot();
  });

  it('transfers.op matches snapshot', () => {
    const output = compileOpFile('operations/transfers.op');
    expect(output).toMatchSnapshot();
  });
});
