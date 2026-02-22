import type { IToken } from 'chevrotain';
import { opCstParser } from './chevrotain-parser-op.js';
import type {
  OpRootNode, OpRouteNode, OpOperationNode, OpParamNode,
  OpRequestNode, OpResponseNode, HttpMethod, DtoTypeNode,
} from './ast.js';

const BaseOpVisitor = opCstParser.getBaseCstVisitorConstructor();

export class OpVisitor extends BaseOpVisitor {
  private file: string;

  constructor(file: string) {
    super();
    this.file = file;
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
    const line = ctx.Colon?.[0]?.startLine ?? 0;

    let params: OpParamNode[] | undefined;
    let operations: OpOperationNode[] = [];

    if (ctx.routeBody) {
      const body = this.visit(ctx.routeBody[0]);
      params = body.params;
      operations = body.operations;
    }

    return { path, params, operations, loc: { file: this.file, line } };
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

  paramsBlock(ctx: any): OpParamNode[] {
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
    const name = identifiers[0].image;
    const typeName = identifiers[1]?.image ?? 'string';
    const line = identifiers[0].startLine ?? 0;

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

    let request: OpRequestNode | undefined;
    let response: OpResponseNode | undefined;

    if (ctx.operationBody) {
      const body = this.visit(ctx.operationBody[0]);
      request = body.request;
      response = body.response;
    }

    return { method, request, response, loc: { file: this.file, line } };
  }

  operationBody(ctx: any): { request?: OpRequestNode; response?: OpResponseNode } {
    let request: OpRequestNode | undefined;
    let response: OpResponseNode | undefined;

    if (ctx.requestBlock) {
      request = this.visit(ctx.requestBlock[0]);
    }
    if (ctx.responseBlock) {
      response = this.visit(ctx.responseBlock[0]);
    }

    return { request, response };
  }

  requestBlock(ctx: any): OpRequestNode | undefined {
    if (!ctx.contentTypeLine) return undefined;
    const ctLine = this.visit(ctx.contentTypeLine[0]);
    const ct = ctLine.contentType.toLowerCase().includes('multipart')
      ? 'multipart/form-data' as const
      : 'application/json' as const;
    return { contentType: ct, bodyType: ctLine.bodyType };
  }

  responseBlock(ctx: any): OpResponseNode | undefined {
    if (!ctx.statusCodeBlock) return undefined;

    // Take the last status code block (matches original parser behavior)
    let result: OpResponseNode | undefined;
    for (const scb of ctx.statusCodeBlock) {
      result = this.visit(scb);
    }
    return result;
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

    const bodyExpr = this.visit(ctx.bodyTypeExpr[0]);

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
