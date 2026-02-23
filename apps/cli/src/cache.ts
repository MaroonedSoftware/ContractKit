import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

const CACHE_FILENAME = '.contract-dsl-cache';

export interface FileHashMap {
  [filePath: string]: string; // path -> sha256 hex
}

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function loadCache(outDir: string): FileHashMap {
  const cachePath = join(outDir, CACHE_FILENAME);
  try {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveCache(outDir: string, cache: FileHashMap): void {
  const cachePath = join(outDir, CACHE_FILENAME);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

export function isFileChanged(
  filePath: string,
  content: string,
  outPath: string,
  cache: FileHashMap,
): boolean {
  if (!existsSync(outPath)) return true;
  const currentHash = computeHash(content);
  return cache[filePath] !== currentHash;
}
