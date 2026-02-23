import { parseDto } from '../src/parser-dto.js';
import { parseOp } from '../src/parser-op.js';
import { generateDto } from '../src/codegen-dto.js';
import { generateOp } from '../src/codegen-op.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import {
  SIMPLE_USER_DTO, VISIBILITY_DTO, INHERITANCE_DTO,
  SIMPLE_USERS_OP, PARAMETERIZED_OP,
} from './helpers.js';

function compileDtoSource(source: string) {
  const diag = new DiagnosticCollector();
  const root = parseDto(source, 'test.dto', diag);
  const output = generateDto(root);
  return { root, output, diag };
}

function compileOpSource(source: string, file = 'users.op') {
  const diag = new DiagnosticCollector();
  const root = parseOp(source, file, diag);
  const output = generateOp(root);
  return { root, output, diag };
}

describe('DTO pipeline (source -> parse -> codegen)', () => {
  it('compiles a simple DTO to valid Zod schema code', () => {
    const { output, diag } = compileDtoSource(SIMPLE_USER_DTO);
    expect(diag.hasErrors()).toBe(false);
    expect(output).toContain("import { z } from 'zod';");
    expect(output).toContain('id: z.uuid()');
    expect(output).toContain('name: z.string()');
    expect(output).toContain('email: z.email()');
    expect(output).toContain('age: z.number().optional()');
    expect(output).toContain('active: z.boolean().default(true)');
  });

  it('compiles a DTO with visibility to three-schema pattern', () => {
    const { output, diag } = compileDtoSource(VISIBILITY_DTO);
    expect(diag.hasErrors()).toBe(false);
    expect(output).toContain('const UserBase = z.strictObject({');
    expect(output).toContain('export const User = z.strictObject({');
    expect(output).toContain('export const UserInput = z.strictObject({');

    // Read schema (User) should not contain writeonly 'password'
    const readSection = output.split('export const User =')[1]!.split('});')[0]!;
    expect(readSection).not.toContain('password');

    // Write schema (UserInput) should not contain readonly 'id'
    const writeSection = output.split('export const UserInput =')[1]!.split('});')[0]!;
    expect(writeSection).not.toContain('id:');
  });

  it('compiles a DTO with inheritance', () => {
    const { output, diag } = compileDtoSource(INHERITANCE_DTO);
    expect(diag.hasErrors()).toBe(false);
    expect(output).toContain('User.extend({');
    expect(output).toContain('z.enum(["admin", "superadmin"])');
  });

  it('compiles a DTO with all type kinds', () => {
    const source = `\
Kitchen {
    tags: array(string)
    coords: tuple(number, number)
    meta: record(string, unknown)
    status: enum(open, closed)
    kind: literal("kitchen")
    value: string | number
    ref: Address
    children: lazy(Kitchen)
}`;
    const { output, diag } = compileDtoSource(source);
    expect(diag.hasErrors()).toBe(false);
    expect(output).toContain('z.array(z.string())');
    expect(output).toContain('z.tuple([z.number(), z.number()])');
    expect(output).toContain('z.record(z.string(), z.unknown())');
    expect(output).toContain('z.enum(["open", "closed"])');
    expect(output).toContain('z.literal("kitchen")');
    expect(output).toContain('z.union([z.string(), z.number()])');
    expect(output).toContain('Address');
    expect(output).toContain('z.lazy(() => Kitchen)');
  });

  it('includes DateTime import when date fields are used', () => {
    const source = `\
Event {
    startDate: date
    createdAt: datetime
}`;
    const { output } = compileDtoSource(source);
    expect(output).toContain("import { DateTime } from 'luxon';");
  });
});

describe('OP pipeline (source -> parse -> codegen)', () => {
  it('compiles a simple operation to Koa router code', () => {
    const { output, diag } = compileOpSource(SIMPLE_USERS_OP);
    expect(diag.hasErrors()).toBe(false);
    expect(output).toContain("import { z } from 'zod';");
    expect(output).toContain('ServerKitRouter');
    expect(output).toContain("UsersRouter.get('/users'");
    expect(output).toContain("UsersRouter.post('/users'");
    expect(output).toContain("bodyParserMiddleware(['json'])");
    expect(output).toContain('ctx.status = 201');
  });

  it('compiles an operation with params, request, and response', () => {
    const { output, diag } = compileOpSource(PARAMETERIZED_OP);
    expect(diag.hasErrors()).toBe(false);
    expect(output).toContain("UsersRouter.get('/users/:id'");
    expect(output).toContain("UsersRouter.delete('/users/:id'");
    expect(output).toContain('parseAndValidate(');
    expect(output).toContain('id: z.uuid()');
  });

  it('uses correct router name for dotted file names', () => {
    const source = `/items { get }`;
    const { output } = compileOpSource(source, 'ledger.items.op');
    expect(output).toContain('LedgerItemsRouter');
  });
});

describe('error handling pipeline', () => {
  it('reports diagnostics for invalid DTO source', () => {
    const { diag } = compileDtoSource('Bad name: string');
    expect(diag.hasErrors()).toBe(true);
  });

  it('reports diagnostics for invalid OP source', () => {
    const { diag } = compileOpSource('no-slash { get }');
    expect(diag.hasErrors()).toBe(true);
  });
});
