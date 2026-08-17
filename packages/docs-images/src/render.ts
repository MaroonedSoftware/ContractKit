import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIGURES } from './figures.ts';
import { PALETTES } from './palette.ts';
import { frame } from './window.ts';
import { document_ } from './svg.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = resolve(repoRoot, 'assets/figures');

/** Renders every figure in both themes. Run with `pnpm docs:images` from the repo root. */
export async function renderAll(): Promise<string[]> {
    mkdirSync(outDir, { recursive: true });
    const written: string[] = [];

    for (const figure of FIGURES) {
        for (const palette of PALETTES) {
            // Framing happens here rather than in each figure so every figure gets the window
            // border for free, and so the clip path can carry a document-unique id.
            const framed = frame(await figure.build(palette), palette, `${figure.name}-clip`);
            const svg = document_(framed.width, framed.height, figure.title, framed.elements);
            const file = resolve(outDir, `${figure.name}-${palette.suffix}.svg`);
            writeFileSync(file, svg);
            written.push(relative(repoRoot, file));
        }
    }

    return written;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    const written = await renderAll();
    for (const file of written) console.log(`  ${file}`);
    console.log(`\n${written.length} figures rendered from ${FIGURES.length} definitions.`);
}
