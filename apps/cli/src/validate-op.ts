import type { OpRootNode } from './ast.js';
import { SECURITY_NONE } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

/** Extract `:paramName` segments from a route path. */
function extractPathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map(m => m[1]!);
}

/**
 * Error when security block references a scheme name not present in the registry.
 * Skips validation when `knownSchemes` is empty (registry not configured).
 */
export function validateSecurity(root: OpRootNode, knownSchemes: Set<string>, diag: DiagnosticCollector): void {
  if (knownSchemes.size === 0) return;
  for (const route of root.routes) {
    // Route-level security
    if (Array.isArray(route.security)) {
      for (const scheme of route.security) {
        if (!knownSchemes.has(scheme.name)) {
          diag.error(root.file, route.loc.line, `Unknown security scheme "${scheme.name}"`);
        }
      }
    }
    // Operation-level security
    for (const op of route.operations) {
      if (op.security !== undefined && op.security !== SECURITY_NONE) {
        for (const scheme of op.security) {
          if (!knownSchemes.has(scheme.name)) {
            diag.error(root.file, op.loc.line, `Unknown security scheme "${scheme.name}"`);
          }
        }
      }
    }
  }
}

/**
 * Warn when a route path contains `:param` placeholders that are not
 * explicitly declared in a `params` block.
 */
export function validateOp(root: OpRootNode, diag: DiagnosticCollector): void {
  for (const route of root.routes) {
    const pathParams = extractPathParams(route.path);
    if (pathParams.length === 0) continue;

    if (!route.params) {
      // No params block at all
      for (const name of pathParams) {
        diag.warn(root.file, route.loc.line, `Path parameter ':${name}' is not explicitly defined in a params block`);
      }
    } else if (typeof route.params === 'string' || !Array.isArray(route.params)) {
      // Type-reference or DtoTypeNode form — all params are covered by the type
      continue;
    } else {
      // Block form — check each path param is declared
      const declared = new Set(route.params.map((p: { name: string }) => p.name));
      for (const name of pathParams) {
        if (!declared.has(name)) {
          diag.warn(root.file, route.loc.line, `Path parameter ':${name}' is not explicitly defined in a params block`);
        }
      }
    }
  }
}
