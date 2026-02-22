import { CstParser } from 'chevrotain';
import {
  allTokens, Indent, Dedent, Newline, Identifier, Colon, Question,
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
      this.MANY2(() => this.CONSUME(Newline));
      this.SUBRULE(this.modelDecl);
    });
    this.MANY3(() => this.CONSUME2(Newline));
    this.CONSUME(Eof);
  });

  // ─── Model ────────────────────────────────────────────────────────────

  // modelDecl: IDENTIFIER COLON IDENTIFIER? NEWLINE (INDENT fieldList DEDENT)?
  public modelDecl = this.RULE('modelDecl', () => {
    this.CONSUME(Identifier);  // model name
    this.CONSUME(Colon);
    this.OPTION(() => {
      this.CONSUME2(Identifier); // base model name (optional)
    });
    this.OPTION2(() => this.CONSUME(Newline));
    this.OPTION3(() => {
      this.CONSUME(Indent);
      this.SUBRULE(this.fieldList);
      this.CONSUME(Dedent);
    });
  });

  // ─── Fields ───────────────────────────────────────────────────────────

  public fieldList = this.RULE('fieldList', () => {
    this.MANY(() => {
      this.MANY2(() => this.CONSUME(Newline));
      this.OPTION(() => {
        this.SUBRULE(this.fieldDecl);
      });
    });
  });

  // fieldDecl handles three cases:
  // 1. Nested object:     name: NEWLINE INDENT fieldList DEDENT
  // 2. Visibility + type: name: readonly typeExpr (= default)? NEWLINE
  // 3. Regular type:      name: typeExpr (= default)? NEWLINE
  public fieldDecl = this.RULE('fieldDecl', () => {
    this.CONSUME(Identifier);  // field name
    this.OPTION(() => this.CONSUME(Question));
    this.CONSUME(Colon);
    this.OR([
      {
        // Case 1: Nested object — next token is NEWLINE (no type on this line)
        GATE: () => {
          const la1 = this.LA(1);
          return la1.tokenType === Newline || la1.tokenType === Eof || la1.tokenType === Dedent;
        },
        ALT: () => {
          this.CONSUME(Newline);
          this.OPTION2(() => {
            this.CONSUME(Indent);
            this.SUBRULE(this.fieldList);
            this.CONSUME(Dedent);
          });
        },
      },
      {
        // Case 2: Visibility modifier + type expression
        GATE: () => {
          const la1 = this.LA(1);
          return la1.tokenType === Identifier &&
            (la1.image === 'readonly' || la1.image === 'writeonly');
        },
        ALT: () => {
          this.CONSUME2(Identifier); // visibility modifier
          this.SUBRULE2(this.typeExpression);
          this.OPTION3(() => {
            this.CONSUME(Equals);
            this.SUBRULE(this.defaultValue);
          });
          this.OPTION4(() => this.CONSUME2(Newline));
        },
      },
      {
        // Case 3: Regular type expression (no visibility)
        ALT: () => {
          this.SUBRULE(this.typeExpression);
          this.OPTION5(() => {
            this.CONSUME2(Equals);
            this.SUBRULE2(this.defaultValue);
          });
          this.OPTION6(() => this.CONSUME3(Newline));
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
    this.OPTION(() => {
      this.SUBRULE(this.inlineField);
      this.MANY(() => {
        this.CONSUME(Comma);
        this.SUBRULE2(this.inlineField);
      });
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
