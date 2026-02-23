import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

export interface DslConfig {
  outDir?: string;
  patterns?: string[];
  servicePathTemplate?: string;
  typeImportPathTemplate?: string;
}

const CONFIG_FILENAME = 'contract-dsl.config.json';

/**
 * Search for contract-dsl.config.json starting from `startDir`,
 * walking up to the filesystem root.
 */
export function loadConfig(startDir: string = process.cwd()): DslConfig {
  let dir = resolve(startDir);

  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    try {
      const text = readFileSync(candidate, 'utf-8');
      return JSON.parse(text) as DslConfig;
    } catch {
      // File not found or invalid -- walk up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return {};
}

export interface ResolvedConfig {
  patterns: string[];
  outDir?: string;
  watch: boolean;
  servicePathTemplate?: string;
  typeImportPathTemplate?: string;
  force: boolean;
}

/** Merge CLI args over config file values. CLI args take precedence. */
export function mergeConfig(
  config: DslConfig,
  cliArgs: { patterns: string[]; outDir?: string; watch: boolean; servicePath?: string; force: boolean },
): ResolvedConfig {
  return {
    patterns: cliArgs.patterns.length > 0 ? cliArgs.patterns : (config.patterns ?? []),
    outDir: cliArgs.outDir ?? config.outDir,
    watch: cliArgs.watch,
    servicePathTemplate: cliArgs.servicePath ?? config.servicePathTemplate,
    typeImportPathTemplate: config.typeImportPathTemplate,
    force: cliArgs.force,
  };
}
