import { CstParser } from 'chevrotain';
import {
  allTokens, Identifier, Colon, Question,
  Equals, Pipe, LParen, RParen, LBrace, RBrace, Comma, Slash,
  StringLit, NumberLit, BooleanLit, Eof,
} from './tokens.js';

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
    this.MANY(() => {
      this.SUBRULE(this.modelDecl);
    });
    this.CONSUME(Eof);
  });

  // ─── Model ────────────────────────────────────────────────────────────

  // modelDecl: IDENTIFIER (COLON IDENTIFIER)? LBRACE fieldList RBRACE
  public modelDecl = this.RULE('modelDecl', () => {
    this.CONSUME(Identifier);  // model name
    this.OPTION(() => {
      this.CONSUME(Colon);
      this.CONSUME2(Identifier); // base model name
    });
    this.CONSUME(LBrace);
    this.SUBRULE(this.fieldList);
    this.CONSUME(RBrace);
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
    this.CONSUME(Identifier);  // field name
    this.OPTION(() => this.CONSUME(Question));
    this.CONSUME(Colon);
    this.OR([
      {
        // Case 1: Visibility modifier + type expression
        GATE: () => {
          const la1 = this.LA(1);
          return la1.tokenType === Identifier &&
            (la1.image === 'readonly' || la1.image === 'writeonly');
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

  public typeExpression = this.RULE('typeExpression', () => {
    this.SUBRULE(this.singleType);
    this.MANY(() => {
      this.CONSUME(Pipe);
      this.SUBRULE2(this.singleType);
    });
  });

  public singleType = this.RULE('singleType', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.inlineBraceObject) },
      {
        ALT: () => {
          this.CONSUME(Identifier);  // type name — visitor inspects image
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
      { ALT: () => this.SUBRULE(this.singleType) },
    ]);
  });

  public argValue = this.RULE('argValue', () => {
    this.OR([
      {
        // regex: /pattern/
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
    this.SUBRULE(this.typeExpression);
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
