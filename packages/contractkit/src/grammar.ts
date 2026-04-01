/**
 * Grammar loader — compiles the Ohm grammar and exports the grammar object.
 * The .ohm file is the source of truth for the Contract DSL syntax.
 */
import * as ohm from 'ohm-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load the grammar source at module init (singleton pattern).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In dev (src/), the .ohm file is a sibling.
// In dist, the .ohm file is copied to the dist directory by the build.
let grammarPath = join(__dirname, 'contractkit.ohm');

let grammarSource: string;
try {
  grammarSource = readFileSync(grammarPath, 'utf-8');
} catch {
  // Fallback: try relative to cwd (for tests running from source)
  grammarPath = join(process.cwd(), 'src', 'contractkit.ohm');
  grammarSource = readFileSync(grammarPath, 'utf-8');
}

export const grammar: ohm.Grammar = ohm.grammar(grammarSource);
