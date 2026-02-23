import type { IToken } from 'chevrotain';
import { opCstParser } from './chevrotain-parser-op.js';
import type {
  OpRootNode, OpRouteNode, OpOperationNode, OpParamNode,
  OpRequestNode, OpResponseNode, HttpMethod, DtoTypeNode,
  ParamSource,
} from './ast.js';
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
    const routes: OpRouteNode[] = [];
    if (ctx.routeDecl) {
      for (const routeCst of ctx.routeDecl) {
        const route = this.visit(routeCst);
        if (route) routes.push(route);
      }
    }
    return { kind: 'opRoot', routes, file: this.file };
  }

  routeDecl(ctx: any): OpRouteNode {
    const path: string = this.visit(ctx.routePath[0]);
    const line = ctx.LBrace?.[0]?.startLine ?? 0;
    const description = this.comments.get(line - 1) ?? this.comments.get(line);

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
    // Reconstruct path from tokens: SLASH, COLON, IDENTIFIER
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
    // Declaration form: params: TypeName
    if (ctx.Colon) {
      const identifiers: IToken[] = ctx.Identifier || [];
      return identifiers[1]?.image ?? '';
    }
    // Block form: params { name: type ... }
    const params: OpParamNode[] = [];
    if (ctx.paramDecl) {
      for (const pd of ctx.paramDecl) {
        const param = this.visit(pd);
        if (param) params.push(param);
      }
    }
    return params;
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
    const description = this.comments.get(line - 1) ?? this.comments.get(line);

    let service: string | undefined;
    let query: OpParamNode[] | undefined;
    let headers: OpParamNode[] | undefined;
    let request: OpRequestNode | undefined;
    let responses: OpResponseNode[] = [];

    if (ctx.operationBody) {
      const body = this.visit(ctx.operationBody[0]);
      service = body.service;
      query = body.query;
      headers = body.headers;
      request = body.request;
      responses = body.responses;
    }

    return { method, service, query, headers, request, responses, description, loc: { file: this.file, line } };
  }

  operationBody(ctx: any): { service?: string; query?: OpParamNode[]; headers?: OpParamNode[]; request?: OpRequestNode; responses: OpResponseNode[] } {
    let service: string | undefined;
    let query: OpParamNode[] | undefined;
    let headers: OpParamNode[] | undefined;
    let request: OpRequestNode | undefined;
    let responses: OpResponseNode[] = [];

    if (ctx.serviceDecl) {
      service = this.visit(ctx.serviceDecl[0]);
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

    return { service, query, headers, request, responses };
  }

  queryBlock(ctx: any): ParamSource {
    // Declaration form: query: TypeName
    if (ctx.Colon) {
      const identifiers: IToken[] = ctx.Identifier || [];
      return identifiers[1]?.image ?? '';
    }
    // Block form: query { name: type ... }
    const params: OpParamNode[] = [];
    if (ctx.paramDecl) {
      for (const pd of ctx.paramDecl) {
        const param = this.visit(pd);
        if (param) params.push(param);
      }
    }
    return params;
  }

  headersBlock(ctx: any): ParamSource {
    // Declaration form: headers: TypeName
    if (ctx.Colon) {
      const identifiers: IToken[] = ctx.Identifier || [];
      return identifiers[1]?.image ?? '';
    }
    // Block form: headers { name: type ... }
    const params: OpParamNode[] = [];
    if (ctx.paramDecl) {
      for (const pd of ctx.paramDecl) {
        const param = this.visit(pd);
        if (param) params.push(param);
      }
    }
    return params;
  }

  serviceDecl(ctx: any): string {
    const identifiers: IToken[] = ctx.Identifier || [];
    // identifiers[0] = "service" keyword, identifiers[1] = service reference
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
    let bodyType: string | undefined;

    if (ctx.contentTypeLine) {
      const ctLine = this.visit(ctx.contentTypeLine[0]);
      contentType = 'application/json';
      bodyType = ctLine.bodyType;
    }

    return { statusCode, contentType, bodyType };
  }

  contentTypeLine(ctx: any): { contentType: string; bodyType: string } {
    const identifiers: IToken[] = ctx.Identifier || [];
    // identifiers[0] = "application", identifiers[1] = "json" or "form-data"
    const ctPart1 = identifiers[0]?.image ?? '';
    const ctPart2 = identifiers[1]?.image ?? '';
    const contentType = `${ctPart1}/${ctPart2}`;

    const bodyExpr = ctx.bodyTypeExpr ? this.visit(ctx.bodyTypeExpr[0]) : '';

    return { contentType, bodyType: bodyExpr };
  }

  bodyTypeExpr(ctx: any): string {
    const identifiers: IToken[] = ctx.Identifier || [];
    const typeName = identifiers[0]?.image ?? '';

    if (ctx.LParen) {
      // array(User) or similar
      const innerType = identifiers[1]?.image ?? '';
      return `${typeName}(${innerType})`;
    }

    return typeName;
  }
}

function resolveSimpleType(name: string): DtoTypeNode {
  const scalars: Record<string, DtoTypeNode> = {
    uuid:    { kind: 'scalar', name: 'uuid' },
    string:  { kind: 'scalar', name: 'string' },
    int:     { kind: 'scalar', name: 'int' },
    number:  { kind: 'scalar', name: 'number' },
    boolean: { kind: 'scalar', name: 'boolean' },
  };
  return scalars[name] ?? { kind: 'ref', name };
}
