import { CstParser } from 'chevrotain';
import {
  allTokens,
  Identifier,
  Colon,
  Question,
  Equals,
  Pipe,
  LParen,
  RParen,
  LBrace,
  RBrace,
  Comma,
  Slash,
  LBracket,
  RBracket,
  Plus,
  Star,
  Caret,
  Backslash,
  Dot,
  Ampersand,
  StringLit,
  NumberLit,
  BooleanLit,
  Eof,
  TripleDash,
} from './tokens.js';

const OBJECT_MODES = new Set(['strict', 'strip', 'loose']);

export class DtoCstParser extends CstParser {
  constructor() {
    super(allTokens, {
      recoveryEnabled: true,
      maxLookahead: 3,
    });
    this.performSelfAnalysis();
  }

  // ─── Top-level ────────────────────────────────────────────────────────

  public dtoRoot = this.RULE('dtoRoot', () => {
    this.OPTION(() => {
      this.SUBRULE(this.frontMatter);
    });
    this.MANY(() => {
      this.SUBRULE(this.modelDecl);
    });
    this.CONSUME(Eof);
  });

  // --- key: value ... ---
  public frontMatter = this.RULE('frontMatter', () => {
    this.CONSUME(TripleDash); // opening ---
    this.MANY(() => {
      this.SUBRULE(this.metaEntry);
    });
    this.CONSUME2(TripleDash); // closing ---
  });

  // key: value (inside front-matter)
  public metaEntry = this.RULE('metaEntry', () => {
    this.CONSUME(Identifier); // key
    this.CONSUME(Colon);
    this.OR([
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME2(Identifier) }, // unquoted value
    ]);
  });

  // ─── Model ────────────────────────────────────────────────────────────

  // modelDecl:
  //   [MODE] IDENTIFIER COLON IDENTIFIER LBRACE fieldList RBRACE   (model with inheritance)
  //   [MODE] IDENTIFIER COLON LBRACE fieldList RBRACE               (model with fields)
  //   IDENTIFIER COLON typeExpression                                (type alias — no mode)
  public modelDecl = this.RULE('modelDecl', () => {
    // Optional modifier prefixes: camel and/or strict|strip|loose in any order (max one each)
    this.OPTION({ GATE: () => OBJECT_MODES.has(this.LA(1).image) || this.LA(1).image === 'camel', DEF: () => this.CONSUME(Identifier) });
    this.OPTION2({ GATE: () => OBJECT_MODES.has(this.LA(1).image) || this.LA(1).image === 'camel', DEF: () => this.CONSUME4(Identifier) });
    this.CONSUME2(Identifier); // model name
    this.CONSUME(Colon);
    this.OR([
      {
        // Model with inheritance: Name : Base { fields }
        GATE: () => {
          const la1 = this.LA(1);
          const la2 = this.LA(2);
          return la1.tokenType === Identifier && la2.tokenType === LBrace;
        },
        ALT: () => {
          this.CONSUME3(Identifier); // base model name
          this.CONSUME(LBrace);
          this.SUBRULE(this.fieldList);
          this.CONSUME(RBrace);
        },
      },
      {
        // Model with fields: Name : { fields }
        GATE: () => this.LA(1).tokenType === LBrace,
        ALT: () => {
          this.CONSUME2(LBrace);
          this.SUBRULE2(this.fieldList);
          this.CONSUME2(RBrace);
        },
      },
      {
        // Type alias: Name : typeExpression
        ALT: () => {
          this.SUBRULE(this.typeExpression);
        },
      },
    ]);
  });

  // ─── Fields ───────────────────────────────────────────────────────────

  public fieldList = this.RULE('fieldList', () => {
    this.MANY(() => {
      this.SUBRULE(this.fieldDecl);
    });
  });

  // fieldDecl handles two cases:
  // 1. Visibility + type: name: readonly typeExpr (= default)?
  // 2. Regular type:      name: typeExpr (= default)?
  // Nested objects are handled via typeExpression → singleType → inlineBraceObject
  public fieldDecl = this.RULE('fieldDecl', () => {
    this.CONSUME(Identifier); // field name
    this.OPTION(() => this.CONSUME(Question));
    this.CONSUME(Colon);
    this.OR([
      {
        // Case 1: Visibility modifier + type expression
        GATE: () => {
          const la1 = this.LA(1);
          return la1.tokenType === Identifier && (la1.image === 'readonly' || la1.image === 'writeonly');
        },
        ALT: () => {
          this.CONSUME2(Identifier); // visibility modifier
          this.SUBRULE2(this.typeExpression);
          this.OPTION2(() => {
            this.CONSUME(Equals);
            this.SUBRULE(this.defaultValue);
          });
        },
      },
      {
        // Case 2: Regular type expression (no visibility)
        ALT: () => {
          this.SUBRULE(this.typeExpression);
          this.OPTION3(() => {
            this.CONSUME2(Equals);
            this.SUBRULE2(this.defaultValue);
          });
        },
      },
    ]);
  });

  // ─── Type expressions ─────────────────────────────────────────────────

  // Union: intersectionExpr (| intersectionExpr)*
  public typeExpression = this.RULE('typeExpression', () => {
    this.SUBRULE(this.intersectionExpr);
    this.MANY(() => {
      this.CONSUME(Pipe);
      this.SUBRULE2(this.intersectionExpr);
    });
  });

  // Intersection: singleType (& singleType)*   — higher precedence than union
  public intersectionExpr = this.RULE('intersectionExpr', () => {
    this.SUBRULE(this.singleType);
    this.MANY(() => {
      this.CONSUME(Ampersand);
      this.SUBRULE2(this.singleType);
    });
  });

  public singleType = this.RULE('singleType', () => {
    this.OR([
      {
        // Mode-prefixed inline object: strict { ... } / strip { ... } / loose { ... }
        GATE: () => OBJECT_MODES.has(this.LA(1).image) && this.LA(2).tokenType === LBrace,
        ALT: () => {
          this.CONSUME(Identifier); // mode keyword
          this.SUBRULE(this.inlineBraceObject);
        },
      },
      { ALT: () => this.SUBRULE2(this.inlineBraceObject) },
      {
        ALT: () => {
          this.CONSUME2(Identifier); // type name — visitor inspects image
          this.OPTION(() => {
            this.CONSUME(LParen);
            this.SUBRULE(this.typeArgs);
            this.CONSUME(RParen);
          });
        },
      },
    ]);
  });

  public typeArgs = this.RULE('typeArgs', () => {
    this.OPTION(() => {
      this.SUBRULE(this.typeArg);
      this.MANY(() => {
        this.CONSUME(Comma);
        this.SUBRULE2(this.typeArg);
      });
    });
  });

  public typeArg = this.RULE('typeArg', () => {
    this.OR([
      {
        // key=value modifier (min=1, max=100, regex=/pattern/, len=6)
        GATE: () => {
          const la1 = this.LA(1);
          const la2 = this.LA(2);
          return la1.tokenType === Identifier && la2.tokenType === Equals;
        },
        ALT: () => {
          this.CONSUME(Identifier);
          this.CONSUME(Equals);
          this.SUBRULE(this.argValue);
        },
      },
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME(NumberLit) },
      { ALT: () => this.CONSUME(BooleanLit) },
      { ALT: () => this.SUBRULE(this.typeExpression) },
    ]);
  });

  public argValue = this.RULE('argValue', () => {
    this.OR([
      {
        // regex: /pattern/ — any token except Slash is allowed inside
        ALT: () => {
          this.CONSUME(Slash);
          this.MANY(() => {
            this.OR2([
              { ALT: () => this.CONSUME(Identifier) },
              { ALT: () => this.CONSUME(NumberLit) },
              { ALT: () => this.CONSUME(LParen) },
              { ALT: () => this.CONSUME(RParen) },
              { ALT: () => this.CONSUME(Pipe) },
              { ALT: () => this.CONSUME(LBrace) },
              { ALT: () => this.CONSUME(RBrace) },
              { ALT: () => this.CONSUME(Question) },
              { ALT: () => this.CONSUME(Equals) },
              { ALT: () => this.CONSUME(Comma) },
              { ALT: () => this.CONSUME(Colon) },
              { ALT: () => this.CONSUME(LBracket) },
              { ALT: () => this.CONSUME(RBracket) },
              { ALT: () => this.CONSUME(Plus) },
              { ALT: () => this.CONSUME(Star) },
              { ALT: () => this.CONSUME(Caret) },
              { ALT: () => this.CONSUME(Backslash) },
              { ALT: () => this.CONSUME(Dot) },
            ]);
          });
          this.CONSUME2(Slash);
        },
      },
      { ALT: () => this.CONSUME2(Identifier) },
      { ALT: () => this.CONSUME2(NumberLit) },
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME(BooleanLit) },
    ]);
  });

  // ─── Inline objects ───────────────────────────────────────────────────

  public inlineBraceObject = this.RULE('inlineBraceObject', () => {
    this.CONSUME(LBrace);
    this.MANY(() => {
      this.SUBRULE(this.inlineField);
      this.OPTION(() => this.CONSUME(Comma));
    });
    this.CONSUME(RBrace);
  });

  public inlineField = this.RULE('inlineField', () => {
    this.CONSUME(Identifier);
    this.OPTION(() => this.CONSUME(Question));
    this.CONSUME(Colon);
    this.OR([
      {
        // Case 1: Visibility modifier + type expression
        GATE: () => {
          const la1 = this.LA(1);
          return la1.tokenType === Identifier && (la1.image === 'readonly' || la1.image === 'writeonly');
        },
        ALT: () => {
          this.CONSUME2(Identifier); // visibility modifier
          this.SUBRULE2(this.typeExpression);
          this.OPTION2(() => {
            this.CONSUME(Equals);
            this.SUBRULE(this.defaultValue);
          });
        },
      },
      {
        // Case 2: Regular type expression (no visibility)
        ALT: () => {
          this.SUBRULE(this.typeExpression);
          this.OPTION3(() => {
            this.CONSUME2(Equals);
            this.SUBRULE2(this.defaultValue);
          });
        },
      },
    ]);
  });

  // ─── Default value ────────────────────────────────────────────────────

  public defaultValue = this.RULE('defaultValue', () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLit) },
      { ALT: () => this.CONSUME(NumberLit) },
      { ALT: () => this.CONSUME(BooleanLit) },
      { ALT: () => this.CONSUME(Identifier) },
    ]);
  });
}

// Singleton parser instance — reuse by setting `parser.input` each time
export const dtoCstParser = new DtoCstParser();
