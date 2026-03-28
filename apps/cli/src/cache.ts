import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

export const DEFAULT_CACHE_FILENAME = '.contract-dsl-cache';

export interface FileHashMap {
  [filePath: string]: string; // path -> sha256 hex
}

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function loadCache(dir: string, filename: string = DEFAULT_CACHE_FILENAME): FileHashMap {
  const cachePath = join(dir, filename);
  try {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveCache(dir: string, cache: FileHashMap, filename: string = DEFAULT_CACHE_FILENAME): void {
  const cachePath = join(dir, filename);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

export function isFileChanged(filePath: string, content: string, outPath: string, cache: FileHashMap): boolean {
  if (!existsSync(outPath)) return true;
  const currentHash = computeHash(content);
  return cache[filePath] !== currentHash;
}
