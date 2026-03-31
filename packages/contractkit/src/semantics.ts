/**
 * Semantic Actions — transforms Ohm parse tree to CkRootNode AST.
 */
import type { Grammar, IterationNode } from 'ohm-js';
import type {
  CkRootNode,
  ModelNode,
  OpRouteNode,
  OpOperationNode,
  OpParamNode,
  OpRequestNode,
  OpResponseNode,
  DtoTypeNode,
  FieldNode,
  ParamSource,
  SecurityNode,
  SecurityFields,
  ObjectMode,
  RouteModifier,
  HttpMethod,
  InlineObjectTypeNode,
} from './ast.js';
import { SECURITY_NONE } from './ast.js';
import {
  buildCompoundType,
  resolveSimpleType,
  extractNullability,
  typeNodeToParamSource,
  OBJECT_MODES,
  type TypeArg,
} from './type-builders.js';
import type { DiagnosticCollector } from './diagnostics.js';

/**
 * Get the line number (1-based) from an Ohm Node.
 */
function getLine(node: { source: { sourceString: string; startIdx: number } }): number {
  const contents = node.source.sourceString;
  let line = 1;
  for (let i = 0; i < node.source.startIdx; i++) {
    if (contents[i] === '\n') line++;
  }
  return line;
}

export function createSemantics(grammar: Grammar) {
  const semantics = grammar.createSemantics();

  semantics.addOperation<any>('toAst(file,diag)', {

    // ─── Top-level ────────────────────────────────────────────────

    Root(preambleOpt, decls, _end) {
      const file = this.args.file as string;
      let meta: Record<string, string> = {};
      let services: Record<string, string> = {};
      let security: SecurityNode | undefined;

      if (preambleOpt.numChildren > 0) {
        const result = preambleOpt.child(0).toAst(file, this.args.diag);
        meta = result.meta ?? {};
        services = result.services ?? {};
        security = result.security;
      }

      const models: ModelNode[] = [];
      const routes: OpRouteNode[] = [];

      for (let i = 0; i < decls.numChildren; i++) {
        const result = decls.child(i).toAst(file, this.args.diag);
        if (result?._ckType === 'route') {
          routes.push(result.value);
        } else if (result?._ckType === 'model') {
          models.push(result.value);
        }
      }

      return { kind: 'ckRoot', meta, services, security, models, routes, file } as CkRootNode;
    },

    Decl(child) {
      const file = this.args.file;
      const diag = this.args.diag;
      const result = child.toAst(file, diag);
      if (child.ctorName === 'RouteDecl') {
        return { _ckType: 'route', value: result };
      } else {
        // ModelDecl
        return { _ckType: 'model', value: result };
      }
    },

    // ─── Options block ───────────────────────────────────────────

    OptionsBlock(_optionsKw, _lb, items, _rb) {
      const meta: Record<string, string> = {};
      const services: Record<string, string> = {};
      let security: SecurityNode | undefined;
      for (let i = 0; i < items.numChildren; i++) {
        const result = items.child(i).toAst(this.args.file, this.args.diag);
        if (result._type === 'security') {
          security = result.value;
        } else if (result.entries) {
          for (const [key, value] of result.entries as [string, string][]) {
            if (result._type === 'keys') meta[key] = value;
            else if (result._type === 'services') services[key] = value;
          }
        }
      }
      return { meta, services, security };
    },

    OptionsBodyItem(child) {
      return child.toAst(this.args.file, this.args.diag);
    },

    OptionsKeysBlock(_keysKw, _colonOpt, _lb, items, _rb) {
      const entries: [string, string][] = [];
      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        if (child.ctorName === 'comment') continue;
        entries.push(child.toAst(this.args.file, this.args.diag));
      }
      return { _type: 'keys', entries };
    },

    OptionsServicesBlock(_servicesKw, _colonOpt, _lb, items, _rb) {
      const entries: [string, string][] = [];
      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        if (child.ctorName === 'comment') continue;
        entries.push(child.toAst(this.args.file, this.args.diag));
      }
      return { _type: 'services', entries };
    },

    OptionsEntry(keyNode, _colon, valueNode) {
      const key = keyNode.sourceString;
      const value = valueNode.toAst(this.args.file, this.args.diag);
      return [key, value] as [string, string];
    },

    optionsValue_quoted(strNode) {
      return strNode.sourceString.slice(1, -1);
    },

    optionsValue_unquoted(rawNode) {
      return rawNode.sourceString.trim();
    },

    // ─── Models ──────────────────────────────────────────────────

    ModelDecl(commentNodes, _contractKw, prefixNode, _colon, bodyNode) {
      const file = this.args.file as string;

      const comments = [];
      for (let i = 0; i < commentNodes.numChildren; i++) {
        comments.push(commentNodes.child(i));
      }
      const description = comments.length > 0
        ? comments.map(c => c.sourceString.replace(/^#\s?/, '').trimEnd()).join('\n')
        : undefined;

      const prefix = prefixNode.toAst(file, this.args.diag) as { name: string; mode?: ObjectMode; inputCase?: 'camel' | 'snake' | 'pascal'; outputCase?: 'camel' | 'snake' | 'pascal'; deprecated?: boolean; line: number };
      const body = bodyNode.toAst(file, this.args.diag);

      const result: ModelNode = {
        kind: 'model',
        name: prefix.name,
        fields: body.fields ?? [],
        loc: { file, line: prefix.line },
      };

      if (body.base) result.base = body.base;
      if (body.type) result.type = body.type;
      if (prefix.mode) result.mode = prefix.mode;
      if (prefix.inputCase) result.inputCase = prefix.inputCase;
      if (prefix.outputCase) result.outputCase = prefix.outputCase;
      if (prefix.deprecated) result.deprecated = true;
      if (description) {
        result.description = description;
      } else if (body.inlineDescription) {
        result.description = body.inlineDescription;
      } else if (body.firstCommentText && body.firstCommentLine === prefix.line) {
        result.description = body.firstCommentText;
      }

      return result;
    },

    ModelPrefix(modifiers, nameNode) {
      let mode: ObjectMode | undefined;
      let inputCase: 'camel' | 'snake' | 'pascal' | undefined;
      let outputCase: 'camel' | 'snake' | 'pascal' | undefined;
      let deprecated: boolean | undefined;
      for (let i = 0; i < modifiers.numChildren; i++) {
        const text = modifiers.child(i).sourceString.trim();
        if (text === 'deprecated') {
          deprecated = true;
        } else {
          const modeMatch = text.match(/^mode\((\w+)\)$/);
          if (modeMatch && OBJECT_MODES.has(modeMatch[1]!)) {
            mode = modeMatch[1] as ObjectMode;
          } else {
            const formatMatch = text.match(/^format\(([^)]+)\)$/);
            if (formatMatch) {
              const args = formatMatch[1]!;
              const inputMatch = args.match(/(?:^|,\s*)input=(\w+)/);
              const outputMatch = args.match(/(?:^|,\s*)output=(\w+)/);
              if (inputMatch) inputCase = inputMatch[1] as 'camel' | 'snake' | 'pascal';
              if (outputMatch) outputCase = outputMatch[1] as 'camel' | 'snake' | 'pascal';
            }
          }
        }
      }
      return {
        name: nameNode.sourceString,
        mode,
        inputCase,
        outputCase,
        deprecated,
        line: getLine(nameNode),
      };
    },

    ModelBody_inheritance(baseNode, _amp, _lb, fieldListNode, _rb) {
      const result = fieldListNode.toAst(this.args.file, this.args.diag) as {
        fields: FieldNode[];
        firstCommentLine?: number;
        firstCommentText?: string;
      };
      return {
        base: baseNode.sourceString,
        fields: result.fields,
        firstCommentLine: result.firstCommentLine,
        firstCommentText: result.firstCommentText,
      };
    },

    ModelBody_fields(_lb, fieldListNode, _rb) {
      const result = fieldListNode.toAst(this.args.file, this.args.diag) as {
        fields: FieldNode[];
        firstCommentLine?: number;
        firstCommentText?: string;
      };
      return {
        fields: result.fields,
        firstCommentLine: result.firstCommentLine,
        firstCommentText: result.firstCommentText,
      };
    },

    ModelBody_alias(typeExprNode, inlineCommentOpt) {
      const type = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      const inlineDescription = (inlineCommentOpt as IterationNode).numChildren > 0
        ? (inlineCommentOpt as IterationNode).child(0).sourceString.replace(/^#\s?/, '').trimEnd()
        : undefined;
      return { type, fields: [], inlineDescription };
    },

    FieldList(items) {
      const file = this.args.file as string;
      const fields: FieldNode[] = [];
      let pendingComment: string | undefined;
      let firstCommentLine: number | undefined;
      let firstCommentText: string | undefined;

      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        if (child.ctorName === 'comment') {
          const commentLine = getLine(child);
          const commentText = child.sourceString.replace(/^#\s?/, '').trimEnd();
          if (fields.length > 0) {
            const lastField = fields[fields.length - 1]!;
            if (commentLine === lastField.loc.line) {
              lastField.description = commentText; // inline comment always wins
              continue;
            }
          }
          if (firstCommentLine === undefined) {
            firstCommentLine = commentLine;
            firstCommentText = commentText;
          }
          pendingComment = pendingComment ? pendingComment + '\n' + commentText : commentText;
        } else {
          const field = child.toAst(file, this.args.diag) as FieldNode;
          if (field) {
            if (pendingComment && !field.description) {
              field.description = pendingComment;
            }
            fields.push(field);
          }
          pendingComment = undefined;
        }
      }
      return { fields, firstCommentLine, firstCommentText };
    },

    FieldEntry(fieldNode, _comma) {
      return fieldNode.toAst(this.args.file, this.args.diag);
    },

    FieldDecl(nameNode, questionOpt, _colon, bodyNode) {
      const file = this.args.file as string;
      const name = nameNode.sourceString;
      const line = getLine(nameNode);
      const optional = questionOpt.sourceString === '?';
      const body = bodyNode.toAst(file, this.args.diag) as {
        type: DtoTypeNode;
        visibility: 'readonly' | 'writeonly' | 'normal';
        deprecated?: boolean;
        default?: string | number | boolean;
      };
      const { type, nullable } = extractNullability(body.type);
      const field: FieldNode = { name, optional, nullable, visibility: body.visibility, type, default: body.default, loc: { file, line } };
      if (body.deprecated) field.deprecated = true;
      return field;
    },

    FieldBody_depWithVisibility(_depKw, visNode, typeExprNode, _eqOpt, defaultValOpt) {
      const vis = visNode.sourceString.trim() as 'readonly' | 'writeonly';
      const type = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      let defaultVal: string | number | boolean | undefined;
      if ((defaultValOpt as IterationNode).numChildren > 0) {
        defaultVal = (defaultValOpt as IterationNode).child(0).toAst(this.args.file, this.args.diag);
      }
      return { type, visibility: vis, deprecated: true, default: defaultVal };
    },

    FieldBody_visibilityDep(visNode, _depKw, typeExprNode, _eqOpt, defaultValOpt) {
      const vis = visNode.sourceString.trim() as 'readonly' | 'writeonly';
      const type = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      let defaultVal: string | number | boolean | undefined;
      if ((defaultValOpt as IterationNode).numChildren > 0) {
        defaultVal = (defaultValOpt as IterationNode).child(0).toAst(this.args.file, this.args.diag);
      }
      return { type, visibility: vis, deprecated: true, default: defaultVal };
    },

    FieldBody_depPlain(_depKw, typeExprNode, _eqOpt, defaultValOpt) {
      const type = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      let defaultVal: string | number | boolean | undefined;
      if ((defaultValOpt as IterationNode).numChildren > 0) {
        defaultVal = (defaultValOpt as IterationNode).child(0).toAst(this.args.file, this.args.diag);
      }
      return { type, visibility: 'normal', deprecated: true, default: defaultVal };
    },

    FieldBody_withVisibility(visNode, typeExprNode, _eqOpt, defaultValOpt) {
      const vis = visNode.sourceString.trim() as 'readonly' | 'writeonly';
      const type = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      let defaultVal: string | number | boolean | undefined;
      if ((defaultValOpt as IterationNode).numChildren > 0) {
        defaultVal = (defaultValOpt as IterationNode).child(0).toAst(this.args.file, this.args.diag);
      }
      return { type, visibility: vis, default: defaultVal };
    },

    FieldBody_plain(typeExprNode, _eqOpt, defaultValOpt) {
      const type = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      let defaultVal: string | number | boolean | undefined;
      if ((defaultValOpt as IterationNode).numChildren > 0) {
        defaultVal = (defaultValOpt as IterationNode).child(0).toAst(this.args.file, this.args.diag);
      }
      return { type, visibility: 'normal', default: defaultVal };
    },

    // ─── Type Expressions ────────────────────────────────────────

    TypeExpression(firstNode, _pipes, restNodes) {
      const file = this.args.file;
      const first = firstNode.toAst(file, this.args.diag) as DtoTypeNode;
      const rest: DtoTypeNode[] = [];
      for (let i = 0; i < restNodes.numChildren; i++) {
        rest.push(restNodes.child(i).toAst(file, this.args.diag));
      }
      if (rest.length === 0) return first;
      return { kind: 'union', members: [first, ...rest] } as DtoTypeNode;
    },

    IntersectionExpr(firstNode, _amps, restNodes) {
      const file = this.args.file;
      const first = firstNode.toAst(file, this.args.diag) as DtoTypeNode;
      const rest: DtoTypeNode[] = [];
      for (let i = 0; i < restNodes.numChildren; i++) {
        rest.push(restNodes.child(i).toAst(file, this.args.diag));
      }
      if (rest.length === 0) return first;
      return { kind: 'intersection', members: [first, ...rest] } as DtoTypeNode;
    },

    SingleType_modedObject(modeNode, objNode) {
      const modeText = modeNode.sourceString.trim();
      const m = modeText.match(/^mode\((\w+)\)$/);
      const mode = (m ? m[1] : modeText) as ObjectMode;
      const obj = objNode.toAst(this.args.file, this.args.diag) as InlineObjectTypeNode;
      return { ...obj, mode };
    },

    SingleType_bareObject(objNode) {
      return objNode.toAst(this.args.file, this.args.diag);
    },

    SingleType_withArgs(nameNode, _lp, argsNode, _rp) {
      const name = nameNode.sourceString;
      const args = argsNode.toAst(this.args.file, this.args.diag) as TypeArg[];
      return buildCompoundType(name, args);
    },

    SingleType_simple(nameNode) {
      return resolveSimpleType(nameNode.sourceString);
    },

    TypeArgs(listNode) {
      return listNode.toAst(this.args.file, this.args.diag);
    },

    TypeArg_keyValue(keyNode, _eq, valNode) {
      return { key: keyNode.sourceString, value: valNode.toAst(this.args.file, this.args.diag) };
    },
    TypeArg_string(node) { return { type: 'string', value: node.sourceString.slice(1, -1) }; },
    TypeArg_number(node) { return { type: 'number', value: Number(node.sourceString) }; },
    TypeArg_boolean(node) { return { type: 'boolean', value: node.sourceString === 'true' }; },
    TypeArg_type(node) { return { type: 'type', value: node.toAst(this.args.file, this.args.diag) }; },

    ArgValue_regex(node) { return node.sourceString.slice(1, -1); },
    ArgValue_ident(node) { return node.sourceString; },
    ArgValue_number(node) { return Number(node.sourceString); },
    ArgValue_string(node) { return node.sourceString.slice(1, -1); },
    ArgValue_boolean(node) { return node.sourceString === 'true'; },

    InlineBraceObject(_lb, fieldsNode, _rb) {
      const fields = fieldsNode.toAst(this.args.file, this.args.diag) as FieldNode[];
      return { kind: 'inlineObject', fields } as InlineObjectTypeNode;
    },

    InlineFieldList(items) {
      const file = this.args.file;
      const fields: FieldNode[] = [];
      let pendingComment: string | undefined;
      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        if (child.ctorName === 'comment') {
          const commentLine = getLine(child);
          const commentText = child.sourceString.replace(/^#\s?/, '').trimEnd();
          if (fields.length > 0) {
            const lastField = fields[fields.length - 1]!;
            if (commentLine === lastField.loc.line) {
              lastField.description = commentText; // inline comment always wins
              continue;
            }
          }
          pendingComment = pendingComment ? pendingComment + '\n' + commentText : commentText;
        } else {
          const field = child.toAst(file, this.args.diag) as FieldNode;
          if (field) {
            if (pendingComment && !field.description) field.description = pendingComment;
            fields.push(field);
          }
          pendingComment = undefined;
        }
      }
      return fields;
    },

    InlineFieldEntry(fieldNode, _comma) {
      return fieldNode.toAst(this.args.file, this.args.diag);
    },

    InlineField(nameNode, questionOpt, _colon, bodyNode) {
      const file = this.args.file as string;
      const name = nameNode.sourceString;
      const line = getLine(nameNode);
      const optional = questionOpt.sourceString === '?';
      const body = bodyNode.toAst(file, this.args.diag) as {
        type: DtoTypeNode;
        visibility: 'readonly' | 'writeonly' | 'normal';
        deprecated?: boolean;
        default?: string | number | boolean;
      };
      const { type, nullable } = extractNullability(body.type);
      const field: FieldNode = { name, optional, nullable, visibility: body.visibility, type, default: body.default, loc: { file, line } };
      if (body.deprecated) field.deprecated = true;
      return field;
    },

    DefaultValue(node) {
      return node.toAst(this.args.file, this.args.diag);
    },

    // ─── Routes ───────────────────────────────────────────────────

    // RouteDecl = comment* operationKwCall RoutePath ":" "{" RouteBody "}"
    RouteDecl(commentNodes, operationKwCallNode, routePathNode, _colon, _lb, routeBodyNode, _rb) {
      const file = this.args.file as string;
      const diag = this.args.diag as DiagnosticCollector;

      const comments = [];
      for (let i = 0; i < commentNodes.numChildren; i++) {
        comments.push(commentNodes.child(i));
      }
      const description = comments.length > 0
        ? comments.map(c => c.sourceString.replace(/^#\s?/, '').trimEnd()).join('\n')
        : undefined;

      const path = routePathNode.toAst(file, diag) as string;
      const line = getLine(routePathNode);

      const kwText = operationKwCallNode.sourceString.trim();
      const modMatch = kwText.match(/^operation\((\w+)\)$/);
      const modifiers: RouteModifier[] = modMatch ? [modMatch[1] as RouteModifier] : [];

      const routeBody = routeBodyNode.toAst(file, diag) as {
        params?: ParamSource;
        paramsMode?: ObjectMode;
        security?: SecurityNode;
        operations: OpOperationNode[];
      };

      return {
        path,
        params: routeBody.params,
        paramsMode: routeBody.paramsMode,
        security: routeBody.security,
        operations: routeBody.operations,
        modifiers: modifiers.length > 0 ? modifiers : undefined,
        description,
        loc: { file, line },
      } as OpRouteNode;
    },

    RoutePath(segments) {
      const parts: string[] = [];
      for (let i = 0; i < segments.numChildren; i++) {
        parts.push(segments.child(i).toAst(this.args.file, this.args.diag));
      }
      return parts.join('');
    },

    PathSegment_param(_slash, _lb, nameNode, _rb) {
      return '/{' + nameNode.sourceString + '}';
    },

    PathSegment_literal(_slash, nameNode) {
      return '/' + nameNode.sourceString;
    },

    // ─── Route Body ───────────────────────────────────────────────

    RouteBody(items) {
      const file = this.args.file;
      const diag = this.args.diag;
      let params: ParamSource | undefined;
      let paramsMode: ObjectMode | undefined;
      let security: SecurityNode | undefined;
      const operations: OpOperationNode[] = [];
      let pendingComment: string | undefined;

      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        const result = child.toAst(file, diag);
        if (result === null || result === undefined) continue;
        if (result._type === 'comment') {
          const text = result.value as string;
          pendingComment = pendingComment ? pendingComment + '\n' + text : text;
          continue;
        }
        if (result._type === 'params') {
          params = result.source;
          paramsMode = result.mode;
        } else if (result._type === 'security') {
          security = result.value;
        } else if (result._type === 'operation') {
          const op = result.value as OpOperationNode;
          if (pendingComment && !op.description) {
            op.description = pendingComment;
          }
          operations.push(op);
        }
        pendingComment = undefined;
      }

      return { params, paramsMode, security, operations };
    },

    RouteBodyItem(child) {
      if (child.ctorName === 'comment') {
        return { _type: 'comment', value: child.sourceString.replace(/^#\s?/, '').trimEnd() };
      }
      return child.toAst(this.args.file, this.args.diag);
    },

    // ─── Params Block ─────────────────────────────────────────────

    ParamsBlock(modeOpt, _paramsKw, _colon, bodyNode) {
      let mode: ObjectMode | undefined;
      if (modeOpt.numChildren > 0) {
        const modeText = modeOpt.child(0).sourceString.trim();
        const m = modeText.match(/^mode\((\w+)\)$/);
        mode = (m ? m[1] : modeText) as ObjectMode;
      }
      const body = bodyNode.toAst(this.args.file, this.args.diag);
      return { _type: 'params', source: body.source, mode };
    },

    ParamsBody_inline(_lb, items, _rb) {
      const file = this.args.file;
      const diag = this.args.diag;
      const params: OpParamNode[] = [];
      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        if (child.ctorName === 'comment') continue;
        params.push(child.toAst(file, diag));
      }
      return { source: params };
    },

    ParamsBody_ref(identNode) {
      return { source: identNode.sourceString };
    },

    ParamDecl(nameNode, _colon, typeNode, commentOpt) {
      const file = this.args.file as string;
      const name = nameNode.sourceString;
      const line = getLine(nameNode);
      const typeName = typeNode.sourceString;

      let description: string | undefined;
      if ((commentOpt as IterationNode).numChildren > 0) {
        description = (commentOpt as IterationNode).child(0).sourceString.replace(/^#\s?/, '').trimEnd();
      }

      return {
        name,
        optional: false,
        nullable: false,
        type: resolveSimpleType(typeName),
        description,
        loc: { file, line },
      } as OpParamNode;
    },

    // ─── HTTP Operations ──────────────────────────────────────────

    HttpOperation(commentNodes, httpMethodCallNode, _colon, _lb, inlineCommentOpt, bodyNode, _rb) {
      const file = this.args.file as string;
      const diag = this.args.diag as DiagnosticCollector;

      const comments = [];
      for (let i = 0; i < commentNodes.numChildren; i++) {
        comments.push(commentNodes.child(i));
      }
      const inlineComment = (inlineCommentOpt as IterationNode).numChildren > 0
        ? (inlineCommentOpt as IterationNode).child(0).sourceString.replace(/^#\s?/, '').trimEnd()
        : undefined;
      const description = inlineComment
        ?? (comments.length > 0 ? comments.map(c => c.sourceString.replace(/^#\s?/, '').trimEnd()).join('\n') : undefined);

      const methodText = httpMethodCallNode.sourceString.trim();
      const modMatch = methodText.match(/\((\w+)\)$/);
      const method = methodText.replace(/\(\w+\)$/, '').trim() as HttpMethod;
      const line = getLine(httpMethodCallNode);

      const modifiers: RouteModifier[] = modMatch ? [modMatch[1] as RouteModifier] : [];

      const body = bodyNode.toAst(file, diag) as {
        service?: string;
        sdk?: string;
        signature?: string;
        signatureDescription?: string;
        query?: ParamSource;
        queryMode?: ObjectMode;
        headers?: ParamSource;
        headersMode?: ObjectMode;
        request?: OpRequestNode;
        responses: OpResponseNode[];
        security?: SecurityNode;
      };

      const op: OpOperationNode = {
        method,
        ...body,
        modifiers: modifiers.length > 0 ? modifiers : undefined,
        description,
        loc: { file, line },
      };

      return { _type: 'operation', value: op };
    },

    // ─── Operation Body ───────────────────────────────────────────

    OperationBody(items) {
      const file = this.args.file;
      const diag = this.args.diag;
      let service: string | undefined;
      let sdk: string | undefined;
      let signature: string | undefined;
      let signatureDescription: string | undefined;
      let query: ParamSource | undefined;
      let queryMode: ObjectMode | undefined;
      let headers: ParamSource | undefined;
      let headersMode: ObjectMode | undefined;
      let request: OpRequestNode | undefined;
      let responses: OpResponseNode[] = [];
      let security: SecurityNode | undefined;

      for (let i = 0; i < items.numChildren; i++) {
        const item = items.child(i).toAst(file, diag);
        if (!item) continue;
        switch (item._type) {
          case 'service': service = item.value; break;
          case 'sdk': sdk = item.value; break;
          case 'signature': signature = item.value; signatureDescription = item.description; break;
          case 'query': query = item.source; queryMode = item.mode; break;
          case 'headers': headers = item.source; headersMode = item.mode; break;
          case 'request': request = item.value; break;
          case 'responses': responses = item.value; break;
          case 'security': security = item.value; break;
        }
      }

      return { service, sdk, signature, signatureDescription, query, queryMode, headers, headersMode, request, responses, security };
    },

    OperationBodyItem(child) {
      if (child.ctorName === 'comment') return null;
      return child.toAst(this.args.file, this.args.diag);
    },

    // ─── Service & SDK ────────────────────────────────────────────

    ServiceDecl(_serviceKw, _colon, identNode) {
      return { _type: 'service', value: identNode.sourceString };
    },

    SdkDecl(_sdkKw, _colon, identNode) {
      return { _type: 'sdk', value: identNode.sourceString };
    },

    SignatureDecl(_signatureKw, _colon, valueNode) {
      const raw = valueNode.sourceString;
      // Strip quotes if present
      const value = (raw.startsWith('"') || raw.startsWith("'")) ? raw.slice(1, -1) : raw;
      return { _type: 'signature', value, description: undefined };
    },

    // ─── Query & Headers ──────────────────────────────────────────

    QueryBlock(modeOpt, _queryKw, _colon, typeExprNode) {
      let mode: ObjectMode | undefined;
      if (modeOpt.numChildren > 0) {
        const modeText = modeOpt.child(0).sourceString.trim();
        const m = modeText.match(/^mode\((\w+)\)$/);
        mode = (m ? m[1] : modeText) as ObjectMode;
      }
      const typeNode = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      return { _type: 'query', source: typeNodeToParamSource(typeNode), mode };
    },

    HeadersBlock(modeOpt, _headersKw, _colon, typeExprNode) {
      let mode: ObjectMode | undefined;
      if (modeOpt.numChildren > 0) {
        const modeText = modeOpt.child(0).sourceString.trim();
        const m = modeText.match(/^mode\((\w+)\)$/);
        mode = (m ? m[1] : modeText) as ObjectMode;
      }
      const typeNode = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      return { _type: 'headers', source: typeNodeToParamSource(typeNode), mode };
    },

    // ─── Request & Response ───────────────────────────────────────

    RequestBlock(_requestKw, _colon, _lb, ctLineNode, _rb) {
      const ctLine = ctLineNode.toAst(this.args.file, this.args.diag) as { contentType: string; bodyType: DtoTypeNode };
      const ct = ctLine.contentType.toLowerCase().includes('multipart') ? 'multipart/form-data' as const : 'application/json' as const;
      return { _type: 'request', value: { contentType: ct, bodyType: ctLine.bodyType } as OpRequestNode };
    },

    ResponseBlock(_responseKw, _colon, _lb, items, _rb) {
      const responses: OpResponseNode[] = [];
      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        if (child.ctorName === 'comment') continue;
        responses.push(child.toAst(this.args.file, this.args.diag));
      }
      return { _type: 'responses', value: responses };
    },

    // StatusCodeBlock = numberLit ":" ("{" ContentTypeLine "}")?
    // ("{" ContentTypeLine "}")? desugars to "{"? ContentTypeLine? "}"? => 3 IterationNode params
    // Total: codeNode, _colon, _lbOpt, ctLineOpt, _rbOpt = 5
    StatusCodeBlock(codeNode, _colon, _lbOpt, ctLineOpt, _rbOpt) {
      const statusCode = parseInt(codeNode.sourceString, 10);
      let contentType: 'application/json' | undefined;
      let bodyType: DtoTypeNode | undefined;

      if ((ctLineOpt as IterationNode).numChildren > 0) {
        const ctLine = (ctLineOpt as IterationNode).child(0).toAst(this.args.file, this.args.diag) as {
          contentType: string;
          bodyType: DtoTypeNode;
        };
        contentType = 'application/json';
        bodyType = ctLine.bodyType;
      }

      return { statusCode, contentType, bodyType } as OpResponseNode;
    },

    ContentTypeLine(part1Node, _slash, part2Node, _colon, typeExprNode) {
      const contentType = part1Node.sourceString + '/' + part2Node.sourceString;
      const bodyType = typeExprNode.toAst(this.args.file, this.args.diag) as DtoTypeNode;
      return { contentType, bodyType };
    },

    // ─── Security ─────────────────────────────────────────────────

    SecurityBlock(_securityKw, _colon, bodyNode) {
      return { _type: 'security', value: bodyNode.toAst(this.args.file, this.args.diag) };
    },

    SecurityBody_none(_noneKw) {
      return SECURITY_NONE;
    },

    SecurityBody_fields(_lb, items, _rb) {
      const file = this.args.file as string;
      const fields: SecurityFields = { loc: { file, line: getLine(this) } };

      for (let i = 0; i < items.numChildren; i++) {
        const child = items.child(i);
        if (child.ctorName === 'comment') continue;
        const result = child.toAst(file, this.args.diag);
        if (result._type === 'roles') {
          fields.roles = result.roles;
          if (result.description) fields.rolesDescription = result.description;
        }
      }

      return fields;
    },

    SecurityField(child) {
      return child.toAst(this.args.file, this.args.diag);
    },

    SecurityRolesLine(_rolesKw, _colon, roleNodes, commentOpt) {
      const roles: string[] = [];
      for (let i = 0; i < roleNodes.numChildren; i++) {
        roles.push(roleNodes.child(i).sourceString.trim());
      }
      let description: string | undefined;
      if ((commentOpt as IterationNode).numChildren > 0) {
        description = (commentOpt as IterationNode).child(0).sourceString.replace(/^#\s?/, '').trimEnd();
      }
      return { _type: 'roles', roles, description };
    },

    RoleName(identNode) {
      return identNode.sourceString;
    },

    SecuritySignatureLine(_signatureKw, _colon, valueNode, _commentOpt) {
      const raw = valueNode.sourceString;
      const value = (raw.startsWith('"') || raw.startsWith("'")) ? raw.slice(1, -1) : raw;
      return { _type: 'signatureField', value };
    },

    // ─── Shared lexical rules ─────────────────────────────────────

    NonemptyListOf(first, _sep, rest) {
      const file = this.args.file;
      const diag = this.args.diag;
      const result = [first.toAst(file, diag)];
      for (let i = 0; i < rest.numChildren; i++) {
        result.push(rest.child(i).toAst(file, diag));
      }
      return result;
    },

    EmptyListOf() {
      return [];
    },

    stringLit(_q1, chars, _q2) {
      return chars.sourceString;
    },

    numberLit(_neg, _digits, _dot, _decimals) {
      return Number(this.sourceString);
    },

    booleanLit(_) {
      return this.sourceString === 'true';
    },

    identifier(_start, _rest) {
      return this.sourceString;
    },

    _terminal() {
      return this.sourceString;
    },

    _iter(...children) {
      return children.map(c => c.toAst(this.args.file, this.args.diag));
    },
  });

  return semantics;
}
