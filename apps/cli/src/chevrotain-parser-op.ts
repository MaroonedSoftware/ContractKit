import { CstParser } from 'chevrotain';
import {
  allTokens, Identifier, Colon,
  LParen, RParen, LBrace, RBrace, Slash, NumberLit, Eof,
} from './tokens.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

export class OpCstParser extends CstParser {
  constructor() {
    super(allTokens, {
      recoveryEnabled: true,
      maxLookahead: 3,
    });
    this.performSelfAnalysis();
  }

  // ─── Top-level ────────────────────────────────────────────────────────

  public opRoot = this.RULE('opRoot', () => {
    this.MANY(() => {
      this.SUBRULE(this.routeDecl);
    });
    this.CONSUME(Eof);
  });

  // ─── Route ────────────────────────────────────────────────────────────

  // routeDecl: routePath LBRACE routeBody RBRACE
  public routeDecl = this.RULE('routeDecl', () => {
    this.SUBRULE(this.routePath);
    this.CONSUME(LBrace);
    this.SUBRULE(this.routeBody);
    this.CONSUME(RBrace);
  });

  // routePath: SLASH (COLON IDENTIFIER | IDENTIFIER) (SLASH (COLON IDENTIFIER | IDENTIFIER))*
  // Route path like /users/:id/posts/:postId
  // Path parameter colons: COLON followed by IDENTIFIER → `:paramName`
  public routePath = this.RULE('routePath', () => {
    this.AT_LEAST_ONE(() => {
      this.CONSUME(Slash);
      this.OR([
        {
          // Path parameter: :paramName
          // Only if COLON is followed by IDENTIFIER (not another SLASH/COLON/etc.)
          GATE: () => {
            const la1 = this.LA(1);
            const la2 = this.LA(2);
            return la1.tokenType === Colon && la2.tokenType === Identifier;
          },
          ALT: () => {
            this.CONSUME2(Colon);
            this.CONSUME(Identifier);
          },
        },
        {
          // Regular path segment
          ALT: () => {
            this.CONSUME2(Identifier);
          },
        },
      ]);
    });
  });

  // routeBody: (paramsBlock | httpOperation)*
  public routeBody = this.RULE('routeBody', () => {
    this.MANY(() => {
      this.OR([
        {
          // params block
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'params';
          },
          ALT: () => this.SUBRULE(this.paramsBlock),
        },
        {
          // http operation (get, post, put, patch, delete)
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && HTTP_METHODS.has(la.image.toLowerCase());
          },
          ALT: () => this.SUBRULE(this.httpOperation),
        },
      ]);
    });
  });

  // ─── Params ───────────────────────────────────────────────────────────

  // paramsBlock: "params" LBRACE paramDecl* RBRACE
  public paramsBlock = this.RULE('paramsBlock', () => {
    this.CONSUME(Identifier);  // "params"
    this.CONSUME(LBrace);
    this.MANY(() => {
      this.SUBRULE(this.paramDecl);
    });
    this.CONSUME(RBrace);
  });

  // paramDecl: IDENTIFIER COLON IDENTIFIER
  public paramDecl = this.RULE('paramDecl', () => {
    this.CONSUME(Identifier);  // param name
    this.CONSUME(Colon);
    this.CONSUME2(Identifier); // param type
  });

  // ─── HTTP Operation ───────────────────────────────────────────────────

  // httpOperation: IDENTIFIER (LBRACE operationBody RBRACE)?
  public httpOperation = this.RULE('httpOperation', () => {
    this.CONSUME(Identifier);  // HTTP method name
    this.OPTION(() => {
      this.CONSUME(LBrace);
      this.SUBRULE(this.operationBody);
      this.CONSUME(RBrace);
    });
  });

  // operationBody: (requestBlock | responseBlock)*
  public operationBody = this.RULE('operationBody', () => {
    this.MANY(() => {
      this.OR([
        {
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'request';
          },
          ALT: () => this.SUBRULE(this.requestBlock),
        },
        {
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'response';
          },
          ALT: () => this.SUBRULE(this.responseBlock),
        },
      ]);
    });
  });

  // ─── Request ──────────────────────────────────────────────────────────

  // requestBlock: "request" LBRACE contentTypeLine RBRACE
  public requestBlock = this.RULE('requestBlock', () => {
    this.CONSUME(Identifier);  // "request"
    this.CONSUME(LBrace);
    this.SUBRULE(this.contentTypeLine);
    this.CONSUME(RBrace);
  });

  // ─── Response ─────────────────────────────────────────────────────────

  // responseBlock: "response" LBRACE statusCodeBlock* RBRACE
  public responseBlock = this.RULE('responseBlock', () => {
    this.CONSUME(Identifier);  // "response"
    this.CONSUME(LBrace);
    this.MANY(() => {
      this.SUBRULE(this.statusCodeBlock);
    });
    this.CONSUME(RBrace);
  });

  // statusCodeBlock: NUMBER (LBRACE contentTypeLine RBRACE)?
  public statusCodeBlock = this.RULE('statusCodeBlock', () => {
    this.CONSUME(NumberLit);   // status code e.g. "200"
    this.OPTION(() => {
      this.CONSUME(LBrace);
      this.SUBRULE(this.contentTypeLine);
      this.CONSUME(RBrace);
    });
  });

  // ─── Content type line ────────────────────────────────────────────────

  // contentTypeLine: IDENTIFIER SLASH IDENTIFIER COLON bodyTypeExpr
  public contentTypeLine = this.RULE('contentTypeLine', () => {
    this.CONSUME(Identifier);   // "application"
    this.CONSUME(Slash);
    this.CONSUME2(Identifier);  // "json" or "form-data"
    this.CONSUME(Colon);
    this.SUBRULE(this.bodyTypeExpr);
  });

  // bodyTypeExpr: IDENTIFIER (LPAREN IDENTIFIER RPAREN)?
  // Handles "User" or "array(User)"
  public bodyTypeExpr = this.RULE('bodyTypeExpr', () => {
    this.CONSUME(Identifier);  // type name
    this.OPTION(() => {
      this.CONSUME(LParen);
      this.CONSUME2(Identifier);  // inner type
      this.CONSUME(RParen);
    });
  });
}

// Singleton parser instance
export const opCstParser = new OpCstParser();
