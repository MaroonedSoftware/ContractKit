import { CstParser } from 'chevrotain';
import {
  allTokens, Identifier, Colon, Question,
  Equals, Pipe, LParen, RParen, LBrace, RBrace,
  Comma, Slash, LBracket, RBracket, Ampersand,
  NumberLit, StringLit, BooleanLit, Eof, TripleDash,
} from './tokens.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const OBJECT_MODES = new Set(['strict', 'strip', 'loose']);
const ROUTE_MODIFIERS = new Set(['internal', 'deprecated', 'public']);

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
    this.OPTION(() => {
      this.SUBRULE(this.frontMatter);
    });
    this.OPTION2({
      GATE: () => this.LA(1).tokenType === Identifier && this.LA(1).image === 'security',
      DEF: () => this.SUBRULE(this.securityBlock),
    });
    this.MANY(() => {
      this.SUBRULE(this.routeDecl);
    });
    this.CONSUME(Eof);
  });

  // --- key: value ... ---
  public frontMatter = this.RULE('frontMatter', () => {
    this.CONSUME(TripleDash);  // opening ---
    this.MANY(() => {
      this.SUBRULE(this.metaEntry);
    });
    this.CONSUME2(TripleDash); // closing ---
  });

  // key: value (inside front-matter)
  public metaEntry = this.RULE('metaEntry', () => {
    this.CONSUME(Identifier);  // key
    this.CONSUME(Colon);
    this.OR([
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME2(Identifier) },  // unquoted value
    ]);
  });

  // ─── Route ────────────────────────────────────────────────────────────

  // routeDecl: routePath [ COLON modifier* ] LBRACE routeBody RBRACE
  public routeDecl = this.RULE('routeDecl', () => {
    this.SUBRULE(this.routePath);
    // Optional `: modifier+` before the opening brace
    this.OPTION({
      GATE: () => this.LA(1).tokenType === Colon && ROUTE_MODIFIERS.has(this.LA(2).image),
      DEF: () => {
        this.CONSUME(Colon);  // route modifier separator
        this.MANY({
          GATE: () => ROUTE_MODIFIERS.has(this.LA(1).image),
          DEF: () => this.CONSUME(Identifier),  // modifier keyword
        });
      },
    });
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

  // routeBody: (paramsBlock | securityBlock | httpOperation)*
  public routeBody = this.RULE('routeBody', () => {
    this.MANY(() => {
      this.OR([
        {
          // params block (optionally prefixed with strict|strip|loose)
          GATE: () => {
            const la1 = this.LA(1);
            const la2 = this.LA(2);
            if (la1.tokenType === Identifier && la1.image === 'params') return true;
            return la1.tokenType === Identifier && OBJECT_MODES.has(la1.image)
              && la2.tokenType === Identifier && la2.image === 'params';
          },
          ALT: () => this.SUBRULE(this.paramsBlock),
        },
        {
          // route-level security default
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'security';
          },
          ALT: () => this.SUBRULE(this.securityBlock),
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

  // paramsBlock: ("strict"|"strip"|"loose")? "params" ":" ( IDENTIFIER | "{" paramDecl* "}" )
  public paramsBlock = this.RULE('paramsBlock', () => {
    this.OPTION({ GATE: () => OBJECT_MODES.has(this.LA(1).image), DEF: () => this.CONSUME(Identifier) });  // optional mode: strict|strip|loose
    this.CONSUME2(Identifier);  // "params"
    this.CONSUME(Colon);
    this.OR([
      {
        GATE: () => this.LA(1).tokenType === Identifier,
        ALT: () => {
          this.CONSUME3(Identifier); // type reference
        },
      },
      {
        ALT: () => {
          this.CONSUME(LBrace);
          this.MANY(() => {
            this.SUBRULE(this.paramDecl);
          });
          this.CONSUME(RBrace);
        },
      },
    ]);
  });

  // paramDecl: IDENTIFIER COLON IDENTIFIER
  public paramDecl = this.RULE('paramDecl', () => {
    this.CONSUME(Identifier);  // param name
    this.CONSUME(Colon);
    this.CONSUME2(Identifier); // param type
  });

  // ─── HTTP Operation ───────────────────────────────────────────────────

  // httpOperation: IDENTIFIER ":" modifier* LBRACE operationBody RBRACE
  public httpOperation = this.RULE('httpOperation', () => {
    this.CONSUME(Identifier);   // HTTP method name
    this.CONSUME(Colon);
    this.MANY({                 // zero or more modifiers (internal, deprecated)
      GATE: () => ROUTE_MODIFIERS.has(this.LA(1).image),
      DEF: () => this.CONSUME2(Identifier),
    });
    this.CONSUME(LBrace);
    this.SUBRULE(this.operationBody);
    this.CONSUME(RBrace);
  });

  // operationBody: (serviceDecl | sdkDecl | queryBlock | headersBlock | requestBlock | responseBlock | securityBlock)*
  public operationBody = this.RULE('operationBody', () => {
    this.MANY(() => {
      this.OR([
        {
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'service';
          },
          ALT: () => this.SUBRULE(this.serviceDecl),
        },
        {
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'sdk';
          },
          ALT: () => this.SUBRULE(this.sdkDecl),
        },
        {
          GATE: () => {
            const la1 = this.LA(1);
            const la2 = this.LA(2);
            if (la1.tokenType === Identifier && la1.image === 'query') return true;
            return la1.tokenType === Identifier && OBJECT_MODES.has(la1.image)
              && la2.tokenType === Identifier && la2.image === 'query';
          },
          ALT: () => this.SUBRULE(this.queryBlock),
        },
        {
          GATE: () => {
            const la1 = this.LA(1);
            const la2 = this.LA(2);
            if (la1.tokenType === Identifier && la1.image === 'headers') return true;
            return la1.tokenType === Identifier && OBJECT_MODES.has(la1.image)
              && la2.tokenType === Identifier && la2.image === 'headers';
          },
          ALT: () => this.SUBRULE(this.headersBlock),
        },
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
        {
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'signature';
          },
          ALT: () => this.SUBRULE(this.signatureDecl),
        },
        {
          GATE: () => {
            const la = this.LA(1);
            return la.tokenType === Identifier && la.image === 'security';
          },
          ALT: () => this.SUBRULE(this.securityBlock),
        },
      ]);
    });
  });

  // ─── Service ────────────────────────────────────────────────────────

  // serviceDecl: "service" COLON IDENTIFIER
  public serviceDecl = this.RULE('serviceDecl', () => {
    this.CONSUME(Identifier);  // "service"
    this.CONSUME(Colon);
    this.CONSUME2(Identifier); // service reference e.g. "LedgerService.updateCategoryMembership"
  });

  // ─── SDK ───────────────────────────────────────────────────────────

  // sdkDecl: "sdk" COLON IDENTIFIER
  public sdkDecl = this.RULE('sdkDecl', () => {
    this.CONSUME(Identifier);  // "sdk"
    this.CONSUME(Colon);
    this.CONSUME2(Identifier); // method name e.g. "getUser"
  });

  // signatureDecl: "signature" COLON (StringLit | Identifier)
  public signatureDecl = this.RULE('signatureDecl', () => {
    this.CONSUME(Identifier);  // "signature"
    this.CONSUME(Colon);
    this.OR([
      { ALT: () => this.CONSUME(StringLit) },    // "quoted-key"
      { ALT: () => this.CONSUME2(Identifier) },  // UNQUOTED_KEY
    ]);
  });

  // ─── Security ───────────────────────────────────────────────────────

  // securityBlock: "security" COLON "none"
  //              | "security" COLON LBRACE securityRolesLine? RBRACE
  public securityBlock = this.RULE('securityBlock', () => {
    this.CONSUME(Identifier);  // "security"
    this.CONSUME(Colon);
    this.OR([
      {
        // security: none
        GATE: () => this.LA(1).tokenType !== LBrace,
        ALT: () => {
          this.CONSUME2(Identifier);  // "none"
        },
      },
      {
        // security: { roles: admin moderator }
        ALT: () => {
          this.CONSUME(LBrace);
          this.OPTION(() => this.SUBRULE(this.securityRolesLine));
          this.CONSUME(RBrace);
        },
      },
    ]);
  });

  // securityRolesLine: "roles" COLON Identifier+
  // Stops consuming identifiers when the next identifier is followed by ':'
  // (which would be a new field).
  public securityRolesLine = this.RULE('securityRolesLine', () => {
    this.CONSUME(Identifier);   // "roles"
    this.CONSUME(Colon);
    this.CONSUME2(Identifier);  // first (mandatory) role name
    this.MANY({
      GATE: () => this.LA(1).tokenType === Identifier && this.LA(2).tokenType !== Colon,
      DEF: () => this.CONSUME3(Identifier),  // additional role names
    });
  });

  // ─── Query ──────────────────────────────────────────────────────────

  // queryBlock: ("strict"|"strip"|"loose")? "query" ":" opTypeExpr
  public queryBlock = this.RULE('queryBlock', () => {
    this.OPTION({ GATE: () => OBJECT_MODES.has(this.LA(1).image), DEF: () => this.CONSUME(Identifier) });  // optional mode: strict|strip|loose
    this.CONSUME2(Identifier);  // "query"
    this.CONSUME(Colon);
    this.SUBRULE(this.opTypeExpr);
  });

  // ─── Headers ────────────────────────────────────────────────────────

  // headersBlock: ("strict"|"strip"|"loose")? "headers" ":" opTypeExpr
  public headersBlock = this.RULE('headersBlock', () => {
    this.OPTION({ GATE: () => OBJECT_MODES.has(this.LA(1).image), DEF: () => this.CONSUME(Identifier) });  // optional mode: strict|strip|loose
    this.CONSUME2(Identifier);  // "headers"
    this.CONSUME(Colon);
    this.SUBRULE(this.opTypeExpr);
  });

  // ─── Request ──────────────────────────────────────────────────────────

  // requestBlock: "request" ":" LBRACE contentTypeLine RBRACE
  public requestBlock = this.RULE('requestBlock', () => {
    this.CONSUME(Identifier);  // "request"
    this.CONSUME(Colon);
    this.CONSUME(LBrace);
    this.SUBRULE(this.contentTypeLine);
    this.CONSUME(RBrace);
  });

  // ─── Response ─────────────────────────────────────────────────────────

  // responseBlock: "response" ":" LBRACE statusCodeBlock* RBRACE
  public responseBlock = this.RULE('responseBlock', () => {
    this.CONSUME(Identifier);  // "response"
    this.CONSUME(Colon);
    this.CONSUME(LBrace);
    this.MANY(() => {
      this.SUBRULE(this.statusCodeBlock);
    });
    this.CONSUME(RBrace);
  });

  // statusCodeBlock: NUMBER ":" (LBRACE contentTypeLine RBRACE)?
  public statusCodeBlock = this.RULE('statusCodeBlock', () => {
    this.CONSUME(NumberLit);   // status code e.g. "200"
    this.CONSUME(Colon);
    this.OPTION(() => {
      this.CONSUME(LBrace);
      this.SUBRULE(this.contentTypeLine);
      this.CONSUME(RBrace);
    });
  });

  // ─── Content type line ────────────────────────────────────────────────

  // contentTypeLine: IDENTIFIER SLASH IDENTIFIER COLON opTypeExpr
  public contentTypeLine = this.RULE('contentTypeLine', () => {
    this.CONSUME(Identifier);   // "application"
    this.CONSUME(Slash);
    this.CONSUME2(Identifier);  // "json" or "form-data"
    this.CONSUME(Colon);
    this.SUBRULE(this.opTypeExpr);
  });

  // ─── OP Type Expressions ──────────────────────────────────────────────
  // These mirror the DTO type system but also support intersection (&)
  // and postfix array syntax ([])

  // opTypeExpr: opIntersectionExpr (PIPE opIntersectionExpr)*
  public opTypeExpr = this.RULE('opTypeExpr', () => {
    this.SUBRULE(this.opIntersectionExpr);
    this.MANY(() => {
      this.CONSUME(Pipe);
      this.SUBRULE2(this.opIntersectionExpr);
    });
  });

  // opIntersectionExpr: opAtomicType (AMPERSAND opAtomicType)*
  public opIntersectionExpr = this.RULE('opIntersectionExpr', () => {
    this.SUBRULE(this.opAtomicType);
    this.MANY(() => {
      this.CONSUME(Ampersand);
      this.SUBRULE2(this.opAtomicType);
    });
  });

  // opAtomicType: opInlineObject | IDENTIFIER (LPAREN opTypeArgs RPAREN)? (LBRACKET RBRACKET)?
  public opAtomicType = this.RULE('opAtomicType', () => {
    this.OR([
      {
        GATE: () => this.LA(1).tokenType === LBrace,
        ALT: () => this.SUBRULE(this.opInlineObject),
      },
      {
        ALT: () => {
          this.CONSUME(Identifier);  // type name
          this.OPTION(() => {
            this.CONSUME(LParen);
            this.SUBRULE(this.opTypeArgs);
            this.CONSUME(RParen);
          });
          // Postfix array: Type[]
          this.OPTION2(() => {
            this.CONSUME(LBracket);
            this.CONSUME(RBracket);
          });
        },
      },
    ]);
  });

  // opTypeArgs: (opTypeArg (COMMA opTypeArg)*)?
  public opTypeArgs = this.RULE('opTypeArgs', () => {
    this.OPTION(() => {
      this.SUBRULE(this.opTypeArg);
      this.MANY(() => {
        this.CONSUME(Comma);
        this.SUBRULE2(this.opTypeArg);
      });
    });
  });

  // opTypeArg: key=value | STRING | NUMBER | BOOLEAN | opTypeExpr
  public opTypeArg = this.RULE('opTypeArg', () => {
    this.OR([
      {
        // key=value constraint (min=1, max=100, etc.)
        GATE: () => {
          const la1 = this.LA(1);
          const la2 = this.LA(2);
          return la1.tokenType === Identifier && la2.tokenType === Equals;
        },
        ALT: () => {
          this.CONSUME(Identifier);
          this.CONSUME(Equals);
          this.SUBRULE(this.opArgValue);
        },
      },
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME(NumberLit) },
      { ALT: () => this.CONSUME(BooleanLit) },
      { ALT: () => this.SUBRULE(this.opTypeExpr) },
    ]);
  });

  // opArgValue: NUMBER | STRING | BOOLEAN | IDENTIFIER
  public opArgValue = this.RULE('opArgValue', () => {
    this.OR([
      { ALT: () => this.CONSUME(NumberLit) },
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME(BooleanLit) },
      { ALT: () => this.CONSUME(Identifier) },
    ]);
  });

  // opInlineObject: LBRACE (opInlineField (COMMA)?)* RBRACE
  public opInlineObject = this.RULE('opInlineObject', () => {
    this.CONSUME(LBrace);
    this.MANY(() => {
      this.SUBRULE(this.opInlineField);
      this.OPTION(() => this.CONSUME(Comma));
    });
    this.CONSUME(RBrace);
  });

  // opInlineField: IDENTIFIER QUESTION? COLON opTypeExpr
  public opInlineField = this.RULE('opInlineField', () => {
    this.CONSUME(Identifier);
    this.OPTION(() => this.CONSUME(Question));
    this.CONSUME(Colon);
    this.SUBRULE(this.opTypeExpr);
  });
}

// Singleton parser instance
export const opCstParser = new OpCstParser();
