import type { OpRootNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

/** Extract `:paramName` segments from a route path. */
function extractPathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map(m => m[1]!);
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
    } else if (typeof route.params === 'string') {
      // Type-reference form (params: SomeType) — all params are covered by the type
      continue;
    } else {
      // Block form — check each path param is declared
      const declared = new Set(route.params.map(p => p.name));
      for (const name of pathParams) {
        if (!declared.has(name)) {
          diag.warn(root.file, route.loc.line, `Path parameter ':${name}' is not explicitly defined in a params block`);
        }
      }
    }
  }
}
