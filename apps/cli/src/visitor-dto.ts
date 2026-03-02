import type { IToken } from 'chevrotain';
import { dtoCstParser } from './chevrotain-parser-dto.js';
import type {
  DtoRootNode, ModelNode, FieldNode, DtoTypeNode,
  ScalarTypeNode, InlineObjectTypeNode, UnionTypeNode, IntersectionTypeNode,
} from './ast.js';
import { SCALAR_NAMES } from './ast.js';

const BaseDtoVisitor = dtoCstParser.getBaseCstVisitorConstructor();

export class DtoVisitor extends BaseDtoVisitor {
  private file: string;
  private comments: Map<number, string>;

  constructor(file: string, comments: Map<number, string>) {
    super();
    this.file = file;
    this.comments = comments;
    this.validateVisitor();
  }

  dtoRoot(ctx: any): DtoRootNode {
    const meta: Record<string, string> = {};
    if (ctx.frontMatter) {
      const entries = this.visit(ctx.frontMatter[0]) as [string, string][];
      for (const [key, value] of entries) {
        meta[key] = value;
      }
    }
    const models: ModelNode[] = [];
    if (ctx.modelDecl) {
      for (const modelCst of ctx.modelDecl) {
        const model = this.visit(modelCst);
        if (model) models.push(model);
      }
    }
    return { kind: 'dtoRoot', meta, models, file: this.file };
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
    // Value is either a StringLit (quoted) or a second Identifier (unquoted)
    if (ctx.StringLit) {
      return [key, ctx.StringLit[0].image];
    }
    // Second identifier is the value
    const value = identifiers[1]?.image ?? '';
    return [key, value];
  }

  modelDecl(ctx: any): ModelNode {
    const identifiers: IToken[] = ctx.Identifier || [];
    const nameToken = identifiers[0]!;
    const name = nameToken.image;
    const line = nameToken.startLine ?? 0;

    // Description from comments: preceding line or same line
    const description = this.comments.get(line) ?? this.comments.get(line - 1);

    // Type alias form: Name : typeExpression (no braces, no fieldList)
    if (ctx.typeExpression && !ctx.fieldList) {
      const type: DtoTypeNode = this.visit(ctx.typeExpression[0]);
      return { kind: 'model', name, fields: [], type, description, loc: { file: this.file, line } };
    }

    // Second identifier (if any) is the base model name
    let base: string | undefined;
    if (identifiers.length > 1) {
      base = identifiers[1]!.image;
    }

    // Parse fields from fieldList
    const fields: FieldNode[] = [];
    if (ctx.fieldList) {
      const result = this.visit(ctx.fieldList[0]);
      if (Array.isArray(result)) fields.push(...result);
    }

    return { kind: 'model', name, base, fields, description, loc: { file: this.file, line } };
  }

  fieldList(ctx: any): FieldNode[] {
    const fields: FieldNode[] = [];
    if (ctx.fieldDecl) {
      for (const fieldCst of ctx.fieldDecl) {
        const field = this.visit(fieldCst);
        if (field) fields.push(field);
      }
    }
    return fields;
  }

  fieldDecl(ctx: any): FieldNode | null {
    const identifiers: IToken[] = ctx.Identifier || [];
    if (identifiers.length === 0) return null;

    const nameToken = identifiers[0]!;
    const fieldName = nameToken.image;
    const line = nameToken.startLine ?? 0;
    const optional = !!ctx.Question;

    // Determine visibility: if there are 2+ identifiers, the second one may be
    // a visibility modifier (from the gated OR branch in the grammar).
    // identifiers[0] = field name
    // identifiers[1] = visibility modifier (if present)
    let visibility: 'readonly' | 'writeonly' | 'normal' = 'normal';
    if (identifiers.length > 1) {
      const vis = identifiers[1]!.image;
      if (vis === 'readonly' || vis === 'writeonly') {
        visibility = vis;
      }
    }

    // Type expression (with or without visibility)
    if (!ctx.typeExpression || ctx.typeExpression.length === 0) return null;

    const extracted = extractNullability(this.visit(ctx.typeExpression[0]));
    let type = extracted.type;
    const nullable = extracted.nullable;

    // Default value
    let defaultVal: string | number | boolean | undefined;
    if (ctx.defaultValue) {
      defaultVal = this.visit(ctx.defaultValue[0]);
    }

    // Description from comments
    const description = this.comments.get(line) ?? this.comments.get(line - 1);

    return {
      name: fieldName, optional, nullable, visibility, type,
      default: defaultVal, description,
      loc: { file: this.file, line },
    };
  }

  typeExpression(ctx: any): DtoTypeNode {
    const types: DtoTypeNode[] = [];
    if (ctx.intersectionExpr) {
      for (const ie of ctx.intersectionExpr) {
        types.push(this.visit(ie));
      }
    }
    if (types.length === 1) return types[0]!;
    return { kind: 'union', members: types };
  }

  intersectionExpr(ctx: any): DtoTypeNode {
    const types: DtoTypeNode[] = [];
    if (ctx.singleType) {
      for (const st of ctx.singleType) {
        types.push(this.visit(st));
      }
    }
    if (types.length === 1) return types[0]!;
    return { kind: 'intersection', members: types };
  }

  singleType(ctx: any): DtoTypeNode {
    if (ctx.inlineBraceObject) {
      return this.visit(ctx.inlineBraceObject[0]);
    }

    const identToken: IToken = ctx.Identifier[0];
    const typeName = identToken.image;

    // Type with parenthesized arguments
    if (ctx.typeArgs) {
      const args = this.visit(ctx.typeArgs[0]) as any[];
      return this.buildCompoundType(typeName, args);
    }

    // Simple scalar
    if (SCALAR_NAMES.has(typeName)) {
      return { kind: 'scalar', name: typeName as ScalarTypeNode['name'] };
    }

    // Model reference
    return { kind: 'ref', name: typeName };
  }

  typeArgs(ctx: any): any[] {
    const args: any[] = [];
    if (ctx.typeArg) {
      for (const ta of ctx.typeArg) {
        args.push(this.visit(ta));
      }
    }
    return args;
  }

  typeArg(ctx: any): any {
    // key=value pair
    if (ctx.Identifier && ctx.Equals) {
      const key = ctx.Identifier[0].image;
      const value = this.visit(ctx.argValue[0]);
      return { key, value };
    }
    // Standalone values
    if (ctx.StringLit) return { type: 'string', value: ctx.StringLit[0].image };
    if (ctx.NumberLit) return { type: 'number', value: Number(ctx.NumberLit[0].image) };
    if (ctx.BooleanLit) return { type: 'boolean', value: ctx.BooleanLit[0].image === 'true' };
    if (ctx.typeExpression) return { type: 'type', value: this.visit(ctx.typeExpression[0]) };
    return null;
  }

  argValue(ctx: any): string | number | boolean {
    // Regex: /pattern/ — collect all tokens between slashes in order
    if (ctx.Slash) {
      const allToks: IToken[] = [];
      for (const key of Object.keys(ctx)) {
        if (key === 'Slash') continue;
        if (Array.isArray(ctx[key])) {
          for (const tok of ctx[key]) {
            if (tok.image !== undefined && tok.startOffset !== undefined) {
              allToks.push(tok);
            }
          }
        }
      }
      allToks.sort((a, b) => a.startOffset - b.startOffset);
      return allToks.map(t => t.image).join('');
    }
    if (ctx.Identifier) return ctx.Identifier[0].image;
    if (ctx.NumberLit) return Number(ctx.NumberLit[0].image);
    if (ctx.StringLit) return ctx.StringLit[0].image;
    if (ctx.BooleanLit) return ctx.BooleanLit[0].image === 'true';
    return '';
  }

  inlineBraceObject(ctx: any): InlineObjectTypeNode {
    const fields: FieldNode[] = [];
    if (ctx.inlineField) {
      for (const f of ctx.inlineField) {
        const field = this.visit(f);
        if (field) fields.push(field);
      }
    }
    return { kind: 'inlineObject', fields };
  }

  inlineField(ctx: any): FieldNode {
    const nameToken: IToken = ctx.Identifier[0];
    const name = nameToken.image;
    const line = nameToken.startLine ?? 0;
    const optional = !!ctx.Question;

    const raw: DtoTypeNode = ctx.typeExpression
      ? this.visit(ctx.typeExpression[0])
      : { kind: 'scalar', name: 'unknown' };
    const { type, nullable } = extractNullability(raw);

    let defaultVal: string | number | boolean | undefined;
    if (ctx.defaultValue) {
      defaultVal = this.visit(ctx.defaultValue[0]);
    }

    return {
      name, optional, nullable, visibility: 'normal', type,
      default: defaultVal,
      loc: { file: this.file, line },
    };
  }

  defaultValue(ctx: any): string | number | boolean {
    if (ctx.StringLit) return ctx.StringLit[0].image;
    if (ctx.NumberLit) return Number(ctx.NumberLit[0].image);
    if (ctx.BooleanLit) return ctx.BooleanLit[0].image === 'true';
    if (ctx.Identifier) return ctx.Identifier[0].image;
    return '';
  }

  // ─── Compound type builders ───────────────────────────────────────────

  private buildCompoundType(name: string, args: any[]): DtoTypeNode {
    switch (name) {
      case 'array': return this.buildArrayType(args);
      case 'tuple': return this.buildTupleType(args);
      case 'record': return this.buildRecordType(args);
      case 'enum': return this.buildEnumType(args);
      case 'literal': return this.buildLiteralType(args);
      case 'lazy': return this.buildLazyType(args);
      default: {
        if (SCALAR_NAMES.has(name)) {
          return this.buildScalarWithModifiers(name as ScalarTypeNode['name'], args);
        }
        return { kind: 'ref', name };
      }
    }
  }

  private buildArrayType(args: any[]): DtoTypeNode {
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

  private buildTupleType(args: any[]): DtoTypeNode {
    const items = args.filter(a => a?.type === 'type').map(a => a.value as DtoTypeNode);
    return { kind: 'tuple', items };
  }

  private buildRecordType(args: any[]): DtoTypeNode {
    const typeArgs = args.filter(a => a?.type === 'type');
    const key: DtoTypeNode = typeArgs[0]?.value ?? { kind: 'scalar', name: 'string' };
    const value: DtoTypeNode = typeArgs[1]?.value ?? { kind: 'scalar', name: 'unknown' };
    return { kind: 'record', key, value };
  }

  private buildEnumType(args: any[]): DtoTypeNode {
    const values: string[] = [];
    for (const a of args) {
      if (a?.type === 'type' && a.value?.kind === 'ref') {
        values.push(a.value.name);
      } else if (a?.type === 'string') {
        values.push(a.value);
      } else if (a?.type === 'type' && a.value?.kind === 'scalar') {
        values.push(a.value.name);
      }
    }
    return { kind: 'enum', values };
  }

  private buildLiteralType(args: any[]): DtoTypeNode {
    const arg = args[0];
    if (!arg) return { kind: 'literal', value: '' };
    if (arg.type === 'string') return { kind: 'literal', value: arg.value };
    if (arg.type === 'number') return { kind: 'literal', value: arg.value };
    if (arg.type === 'boolean') return { kind: 'literal', value: arg.value };
    return { kind: 'literal', value: String(arg.value) };
  }

  private buildLazyType(args: any[]): DtoTypeNode {
    const typeArg = args.find(a => a?.type === 'type');
    const inner: DtoTypeNode = typeArg?.value ?? { kind: 'scalar', name: 'unknown' };
    return { kind: 'lazy', inner };
  }

  private buildScalarWithModifiers(name: ScalarTypeNode['name'], args: any[]): ScalarTypeNode {
    const scalar: ScalarTypeNode = { kind: 'scalar', name };
    for (const a of args) {
      if (!a?.key) continue;
      if (a.key === 'min') scalar.min = name === 'bigint' ? BigInt(a.value) : Number(a.value);
      if (a.key === 'max') scalar.max = name === 'bigint' ? BigInt(a.value) : Number(a.value);
      if (a.key === 'len' || a.key === 'length') scalar.len = Number(a.value);
      if (a.key === 'regex') scalar.regex = String(a.value);
    }
    return scalar;
  }
}

function extractNullability(type: DtoTypeNode): { type: DtoTypeNode; nullable: boolean } {
  if (type.kind === 'union') {
    const union = type as UnionTypeNode;
    const nullIdx = union.members.findIndex(
      m => m.kind === 'scalar' && (m as ScalarTypeNode).name === 'null'
    );
    if (nullIdx !== -1) {
      union.members.splice(nullIdx, 1);
      return { type: union.members.length === 1 ? union.members[0]! : type, nullable: true };
    }
  } else if (type.kind === 'scalar' && type.name === 'null') {
    return { type, nullable: true };
  }
  return { type, nullable: false };
}
