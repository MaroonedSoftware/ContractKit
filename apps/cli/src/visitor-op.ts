import type { IToken } from 'chevrotain';
import { opCstParser } from './chevrotain-parser-op.js';
import type {
  OpRootNode, OpRouteNode, OpOperationNode, OpParamNode,
  OpRequestNode, OpResponseNode, HttpMethod, DtoTypeNode,
  FieldNode, ParamSource, ScalarTypeNode, InlineObjectTypeNode,
} from './ast.js';
import { SCALAR_NAMES } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

const BaseOpVisitor = opCstParser.getBaseCstVisitorConstructor();

export class OpVisitor extends BaseOpVisitor {
  private file: string;
  private diag: DiagnosticCollector;
  private comments: Map<number, string>;

  constructor(file: string, diag: DiagnosticCollector, comments: Map<number, string>) {
    super();
    this.file = file;
    this.diag = diag;
    this.comments = comments;
    this.validateVisitor();
  }

  opRoot(ctx: any): OpRootNode {
    const meta: Record<string, string> = {};
    if (ctx.frontMatter) {
      const entries = this.visit(ctx.frontMatter[0]) as [string, string][];
      for (const [key, value] of entries) {
        meta[key] = value;
      }
    }
    const routes: OpRouteNode[] = [];
    if (ctx.routeDecl) {
      for (const routeCst of ctx.routeDecl) {
        const route = this.visit(routeCst);
        if (route) routes.push(route);
      }
    }
    return { kind: 'opRoot', meta, routes, file: this.file };
  }

  frontMatter(ctx: any): [string, string][] {
    const entries: [string, string][] = [];
    if (ctx.metaEntry) {
      for (const entryCst of ctx.metaEntry) {
        const entry = this.visit(entryCst);
        if (entry) entries.push(entry);
      }
    }
    return entries;
  }

  metaEntry(ctx: any): [string, string] {
    const identifiers: IToken[] = ctx.Identifier || [];
    const key = identifiers[0]?.image ?? '';
    if (ctx.StringLit) {
      return [key, ctx.StringLit[0].image];
    }
    const value = identifiers[1]?.image ?? '';
    return [key, value];
  }

  routeDecl(ctx: any): OpRouteNode {
    const path: string = this.visit(ctx.routePath[0]);
    const line = ctx.LBrace?.[0]?.startLine ?? 0;
    const description = this.comments.get(line) ?? this.comments.get(line - 1);

    let params: OpParamNode[] | undefined;
    let operations: OpOperationNode[] = [];

    if (ctx.routeBody) {
      const body = this.visit(ctx.routeBody[0]);
      params = body.params;
      operations = body.operations;
    }

    return { path, params, operations, description, loc: { file: this.file, line } };
  }

  routePath(ctx: any): string {
    const allToks: IToken[] = [];

    if (ctx.Slash) for (const t of ctx.Slash) allToks.push(t);
    if (ctx.Colon) for (const t of ctx.Colon) allToks.push(t);
    if (ctx.Identifier) for (const t of ctx.Identifier) allToks.push(t);

    allToks.sort((a, b) => a.startOffset - b.startOffset);

    return allToks.map(t => t.image || t.tokenType.name.charAt(0).toLowerCase()).join('');
  }

  routeBody(ctx: any): { params?: OpParamNode[]; operations: OpOperationNode[] } {
    let params: OpParamNode[] | undefined;
    const operations: OpOperationNode[] = [];

    if (ctx.paramsBlock) {
      params = this.visit(ctx.paramsBlock[0]);
    }
    if (ctx.httpOperation) {
      for (const opCst of ctx.httpOperation) {
        const op = this.visit(opCst);
        if (op) operations.push(op);
      }
    }

    return { params, operations };
  }

  paramsBlock(ctx: any): ParamSource {
    return this.visitParamSource(ctx);
  }

  paramDecl(ctx: any): OpParamNode {
    const identifiers: IToken[] = ctx.Identifier || [];
    const name = identifiers[0]!.image;
    const line = identifiers[0]!.startLine ?? 0;

    if (!identifiers[1]) {
      this.diag.warn(this.file, line, `Path parameter "${name}" has no explicit type; defaulting to string`);
    }
    const typeName = identifiers[1]?.image ?? 'string';

    return {
      name,
      type: resolveSimpleType(typeName),
      loc: { file: this.file, line },
    };
  }

  httpOperation(ctx: any): OpOperationNode {
    const methodToken: IToken = ctx.Identifier[0];
    const method = methodToken.image.toLowerCase() as HttpMethod;
    const line = methodToken.startLine ?? 0;
    const description = this.comments.get(line) ?? this.comments.get(line - 1);

    let service: string | undefined;
    let sdk: string | undefined;
    let query: ParamSource | undefined;
    let headers: ParamSource | undefined;
    let request: OpRequestNode | undefined;
    let responses: OpResponseNode[] = [];

    if (ctx.operationBody) {
      const body = this.visit(ctx.operationBody[0]);
      service = body.service;
      sdk = body.sdk;
      query = body.query;
      headers = body.headers;
      request = body.request;
      responses = body.responses;
    }

    return { method, service, sdk, query, headers, request, responses, description, loc: { file: this.file, line } };
  }

  operationBody(ctx: any): { service?: string; sdk?: string; query?: ParamSource; headers?: ParamSource; request?: OpRequestNode; responses: OpResponseNode[] } {
    let service: string | undefined;
    let sdk: string | undefined;
    let query: ParamSource | undefined;
    let headers: ParamSource | undefined;
    let request: OpRequestNode | undefined;
    let responses: OpResponseNode[] = [];

    if (ctx.serviceDecl) {
      service = this.visit(ctx.serviceDecl[0]);
    }
    if (ctx.sdkDecl) {
      sdk = this.visit(ctx.sdkDecl[0]);
    }
    if (ctx.queryBlock) {
      query = this.visit(ctx.queryBlock[0]);
    }
    if (ctx.headersBlock) {
      headers = this.visit(ctx.headersBlock[0]);
    }
    if (ctx.requestBlock) {
      request = this.visit(ctx.requestBlock[0]);
    }
    if (ctx.responseBlock) {
      responses = this.visit(ctx.responseBlock[0]);
    }

    return { service, sdk, query, headers, request, responses };
  }

  queryBlock(ctx: any): ParamSource {
    const typeNode: DtoTypeNode = this.visit(ctx.opTypeExpr[0]);
    return typeNodeToParamSource(typeNode);
  }

  headersBlock(ctx: any): ParamSource {
    const typeNode: DtoTypeNode = this.visit(ctx.opTypeExpr[0]);
    return typeNodeToParamSource(typeNode);
  }

  private visitParamSource(ctx: any): ParamSource {
    // Block form: keyword { name: type ... }
    if (ctx.LBrace) {
      const params: OpParamNode[] = [];
      if (ctx.paramDecl) {
        for (const pd of ctx.paramDecl) {
          const param = this.visit(pd);
          if (param) params.push(param);
        }
      }
      return params;
    }
    // Declaration form: keyword: TypeName
    const identifiers: IToken[] = ctx.Identifier || [];
    return identifiers[1]?.image ?? '';
  }

  serviceDecl(ctx: any): string {
    const identifiers: IToken[] = ctx.Identifier || [];
    return identifiers[1]?.image ?? '';
  }

  sdkDecl(ctx: any): string {
    const identifiers: IToken[] = ctx.Identifier || [];
    return identifiers[1]?.image ?? '';
  }

  requestBlock(ctx: any): OpRequestNode | undefined {
    if (!ctx.contentTypeLine) return undefined;
    const ctLine = this.visit(ctx.contentTypeLine[0]);
    const ct = ctLine.contentType.toLowerCase().includes('multipart')
      ? 'multipart/form-data' as const
      : 'application/json' as const;
    return { contentType: ct, bodyType: ctLine.bodyType };
  }

  responseBlock(ctx: any): OpResponseNode[] {
    const responses: OpResponseNode[] = [];
    if (ctx.statusCodeBlock) {
      for (const scb of ctx.statusCodeBlock) {
        responses.push(this.visit(scb));
      }
    }
    return responses;
  }

  statusCodeBlock(ctx: any): OpResponseNode {
    const statusCode = parseInt(ctx.NumberLit[0].image, 10);

    let contentType: 'application/json' | undefined;
    let bodyType: DtoTypeNode | undefined;

    if (ctx.contentTypeLine) {
      const ctLine = this.visit(ctx.contentTypeLine[0]);
      contentType = 'application/json';
      bodyType = ctLine.bodyType;
    }

    return { statusCode, contentType, bodyType };
  }

  contentTypeLine(ctx: any): { contentType: string; bodyType: DtoTypeNode } {
    const identifiers: IToken[] = ctx.Identifier || [];
    const ctPart1 = identifiers[0]?.image ?? '';
    const ctPart2 = identifiers[1]?.image ?? '';
    const contentType = `${ctPart1}/${ctPart2}`;

    const bodyType: DtoTypeNode = ctx.opTypeExpr
      ? this.visit(ctx.opTypeExpr[0])
      : { kind: 'scalar', name: 'unknown' };

    return { contentType, bodyType };
  }

  // ─── OP Type Expression Visitors ────────────────────────────────────

  opTypeExpr(ctx: any): DtoTypeNode {
    const members: DtoTypeNode[] = [];
    if (ctx.opIntersectionExpr) {
      for (const ie of ctx.opIntersectionExpr) {
        members.push(this.visit(ie));
      }
    }
    if (members.length === 1) return members[0]!;
    return { kind: 'union', members };
  }

  opIntersectionExpr(ctx: any): DtoTypeNode {
    const members: DtoTypeNode[] = [];
    if (ctx.opAtomicType) {
      for (const at of ctx.opAtomicType) {
        members.push(this.visit(at));
      }
    }
    if (members.length === 1) return members[0]!;
    return { kind: 'intersection', members };
  }

  opAtomicType(ctx: any): DtoTypeNode {
    if (ctx.opInlineObject) {
      return this.visit(ctx.opInlineObject[0]);
    }

    const identToken: IToken = ctx.Identifier[0];
    const typeName = identToken.image;

    // Type with arguments: array(User), string(min=1), etc.
    if (ctx.opTypeArgs) {
      const args = this.visit(ctx.opTypeArgs[0]) as any[];
      const node = buildCompoundType(typeName, args);
      if (ctx.LBracket) {
        return { kind: 'array', item: node };
      }
      return node;
    }

    // Postfix array: Type[]
    if (ctx.LBracket) {
      const base = resolveSimpleType(typeName);
      return { kind: 'array', item: base };
    }

    return resolveSimpleType(typeName);
  }

  opTypeArgs(ctx: any): any[] {
    const args: any[] = [];
    if (ctx.opTypeArg) {
      for (const ta of ctx.opTypeArg) {
        args.push(this.visit(ta));
      }
    }
    return args;
  }

  opTypeArg(ctx: any): any {
    if (ctx.Identifier && ctx.Equals) {
      const key = ctx.Identifier[0].image;
      const value = this.visit(ctx.opArgValue[0]);
      return { key, value };
    }
    if (ctx.StringLit) return { type: 'string', value: ctx.StringLit[0].image };
    if (ctx.NumberLit) return { type: 'number', value: Number(ctx.NumberLit[0].image) };
    if (ctx.BooleanLit) return { type: 'boolean', value: ctx.BooleanLit[0].image === 'true' };
    if (ctx.opTypeExpr) return { type: 'type', value: this.visit(ctx.opTypeExpr[0]) };
    return null;
  }

  opArgValue(ctx: any): string | number | boolean {
    if (ctx.NumberLit) return Number(ctx.NumberLit[0].image);
    if (ctx.StringLit) return ctx.StringLit[0].image;
    if (ctx.BooleanLit) return ctx.BooleanLit[0].image === 'true';
    if (ctx.Identifier) return ctx.Identifier[0].image;
    return '';
  }

  opInlineObject(ctx: any): InlineObjectTypeNode {
    const fields: FieldNode[] = [];
    if (ctx.opInlineField) {
      for (const f of ctx.opInlineField) {
        const field = this.visit(f);
        if (field) fields.push(field);
      }
    }
    return { kind: 'inlineObject', fields };
  }

  opInlineField(ctx: any): FieldNode {
    const nameToken: IToken = ctx.Identifier[0];
    const name = nameToken.image;
    const line = nameToken.startLine ?? 0;
    const optional = !!ctx.Question;

    const type: DtoTypeNode = ctx.opTypeExpr
      ? this.visit(ctx.opTypeExpr[0])
      : { kind: 'scalar', name: 'unknown' };

    return {
      name,
      optional,
      nullable: false,
      visibility: 'normal',
      type,
      loc: { file: this.file, line },
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function resolveSimpleType(name: string): DtoTypeNode {
  if (SCALAR_NAMES.has(name as any)) {
    return { kind: 'scalar', name: name as ScalarTypeNode['name'] };
  }
  return { kind: 'ref', name };
}

/** Convert a DtoTypeNode to ParamSource for query/headers blocks. */
function typeNodeToParamSource(node: DtoTypeNode): ParamSource {
  if (node.kind === 'ref') return node.name;
  if (node.kind === 'inlineObject') {
    return node.fields.map(f => ({
      name: f.name,
      type: f.type,
      loc: f.loc,
    }));
  }
  return node;
}

/** Build a compound type from type name and args (mirrors DTO visitor logic). */
function buildCompoundType(name: string, args: any[]): DtoTypeNode {
  switch (name) {
    case 'array': {
      const typeArgs = args.filter(a => a?.type === 'type');
      const item: DtoTypeNode = typeArgs[0]?.value ?? { kind: 'scalar', name: 'unknown' };
      let min: number | undefined;
      let max: number | undefined;
      for (const a of args) {
        if (a?.key === 'min') min = Number(a.value);
        if (a?.key === 'max') max = Number(a.value);
      }
      return { kind: 'array', item, min, max };
    }
    case 'tuple': {
      const items = args.filter(a => a?.type === 'type').map(a => a.value as DtoTypeNode);
      return { kind: 'tuple', items };
    }
    case 'record': {
      const typeArgs = args.filter(a => a?.type === 'type');
      const key: DtoTypeNode = typeArgs[0]?.value ?? { kind: 'scalar', name: 'string' };
      const value: DtoTypeNode = typeArgs[1]?.value ?? { kind: 'scalar', name: 'unknown' };
      return { kind: 'record', key, value };
    }
    case 'enum': {
      const values: string[] = [];
      for (const a of args) {
        if (a?.type === 'type' && a.value?.kind === 'ref') values.push(a.value.name);
        else if (a?.type === 'string') values.push(a.value);
        else if (a?.type === 'type' && a.value?.kind === 'scalar') values.push(a.value.name);
      }
      return { kind: 'enum', values };
    }
    case 'literal': {
      const arg = args[0];
      if (!arg) return { kind: 'literal', value: '' };
      if (arg.type === 'string') return { kind: 'literal', value: arg.value };
      if (arg.type === 'number') return { kind: 'literal', value: arg.value };
      if (arg.type === 'boolean') return { kind: 'literal', value: arg.value };
      return { kind: 'literal', value: String(arg.value) };
    }
    case 'lazy': {
      const typeArg = args.find(a => a?.type === 'type');
      const inner: DtoTypeNode = typeArg?.value ?? { kind: 'scalar', name: 'unknown' };
      return { kind: 'lazy', inner };
    }
    default: {
      if (SCALAR_NAMES.has(name)) {
        const scalar: ScalarTypeNode = { kind: 'scalar', name: name as ScalarTypeNode['name'] };
        for (const a of args) {
          if (!a?.key) continue;
          if (a.key === 'min') scalar.min = name === 'bigint' ? BigInt(a.value) : Number(a.value);
          if (a.key === 'max') scalar.max = name === 'bigint' ? BigInt(a.value) : Number(a.value);
          if (a.key === 'len' || a.key === 'length') scalar.len = Number(a.value);
          if (a.key === 'regex') scalar.regex = String(a.value);
        }
        return scalar;
      }
      return { kind: 'ref', name };
    }
  }
}
