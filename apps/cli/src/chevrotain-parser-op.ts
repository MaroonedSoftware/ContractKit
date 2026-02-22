import { CstParser } from 'chevrotain';
import {
  allTokens, Indent, Dedent, Newline, Identifier, Colon,
  LParen, RParen, Slash, NumberLit, Eof,
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
      this.MANY2(() => this.CONSUME(Newline));
      this.SUBRULE(this.routeDecl);
    });
    this.MANY3(() => this.CONSUME2(Newline));
    this.CONSUME(Eof);
  });

  // ─── Route ────────────────────────────────────────────────────────────

  // routeDecl: routePath COLON NEWLINE INDENT routeBody DEDENT
  public routeDecl = this.RULE('routeDecl', () => {
    this.SUBRULE(this.routePath);
    this.CONSUME(Colon);         // terminating colon
    this.OPTION(() => this.CONSUME(Newline));
    this.CONSUME(Indent);
    this.SUBRULE(this.routeBody);
    this.CONSUME(Dedent);
  });

  // routePath: SLASH (COLON IDENTIFIER | IDENTIFIER) (SLASH (COLON IDENTIFIER | IDENTIFIER))*
  // Route path like /users/:id/posts/:postId
  // The terminating COLON is NOT consumed here — it's handled by routeDecl.
  // Path parameter colons: COLON followed by IDENTIFIER → `:paramName`
  // Terminating colon: COLON NOT followed by IDENTIFIER → stop
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
      this.MANY2(() => this.CONSUME(Newline));
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
    this.MANY3(() => this.CONSUME2(Newline));
  });

  // ─── Params ───────────────────────────────────────────────────────────

  // paramsBlock: "params" COLON NEWLINE INDENT paramDecl* DEDENT
  public paramsBlock = this.RULE('paramsBlock', () => {
    this.CONSUME(Identifier);  // "params"
    this.CONSUME(Colon);
    this.OPTION(() => this.CONSUME(Newline));
    this.CONSUME(Indent);
    this.MANY(() => {
      this.MANY2(() => this.CONSUME2(Newline));
      this.SUBRULE(this.paramDecl);
    });
    this.MANY3(() => this.CONSUME3(Newline));
    this.CONSUME(Dedent);
  });

  // paramDecl: IDENTIFIER COLON IDENTIFIER NEWLINE
  public paramDecl = this.RULE('paramDecl', () => {
    this.CONSUME(Identifier);  // param name
    this.CONSUME(Colon);
    this.CONSUME2(Identifier); // param type
    this.OPTION(() => this.CONSUME(Newline));
  });

  // ─── HTTP Operation ───────────────────────────────────────────────────

  // httpOperation: IDENTIFIER COLON NEWLINE (INDENT operationBody DEDENT)?
  public httpOperation = this.RULE('httpOperation', () => {
    this.CONSUME(Identifier);  // HTTP method name
    this.CONSUME(Colon);
    this.OPTION(() => this.CONSUME(Newline));
    this.OPTION2(() => {
      this.CONSUME(Indent);
      this.SUBRULE(this.operationBody);
      this.CONSUME(Dedent);
    });
  });

  // operationBody: (requestBlock | responseBlock)*
  public operationBody = this.RULE('operationBody', () => {
    this.MANY(() => {
      this.MANY2(() => this.CONSUME(Newline));
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
    this.MANY3(() => this.CONSUME2(Newline));
  });

  // ─── Request ──────────────────────────────────────────────────────────

  // requestBlock: "request" COLON NEWLINE INDENT contentTypeLine DEDENT
  public requestBlock = this.RULE('requestBlock', () => {
    this.CONSUME(Identifier);  // "request"
    this.CONSUME(Colon);
    this.OPTION(() => this.CONSUME(Newline));
    this.CONSUME(Indent);
    this.SUBRULE(this.contentTypeLine);
    this.MANY(() => this.CONSUME2(Newline));
    this.CONSUME(Dedent);
  });

  // ─── Response ─────────────────────────────────────────────────────────

  // responseBlock: "response" COLON NEWLINE INDENT statusCodeBlock* DEDENT
  public responseBlock = this.RULE('responseBlock', () => {
    this.CONSUME(Identifier);  // "response"
    this.CONSUME(Colon);
    this.OPTION(() => this.CONSUME(Newline));
    this.CONSUME(Indent);
    this.MANY(() => {
      this.MANY2(() => this.CONSUME2(Newline));
      this.SUBRULE(this.statusCodeBlock);
    });
    this.MANY3(() => this.CONSUME3(Newline));
    this.CONSUME(Dedent);
  });

  // statusCodeBlock: NUMBER COLON NEWLINE (INDENT contentTypeLine DEDENT)?
  public statusCodeBlock = this.RULE('statusCodeBlock', () => {
    this.CONSUME(NumberLit);   // status code e.g. "200"
    this.CONSUME(Colon);
    this.OPTION(() => this.CONSUME(Newline));
    this.OPTION2(() => {
      this.CONSUME(Indent);
      this.SUBRULE(this.contentTypeLine);
      this.MANY(() => this.CONSUME2(Newline));
      this.CONSUME(Dedent);
    });
  });

  // ─── Content type line ────────────────────────────────────────────────

  // contentTypeLine: IDENTIFIER SLASH IDENTIFIER COLON bodyTypeExpr NEWLINE
  public contentTypeLine = this.RULE('contentTypeLine', () => {
    this.CONSUME(Identifier);   // "application"
    this.CONSUME(Slash);
    this.CONSUME2(Identifier);  // "json" or "form-data"
    this.CONSUME(Colon);
    this.SUBRULE(this.bodyTypeExpr);
    this.OPTION(() => this.CONSUME(Newline));
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
