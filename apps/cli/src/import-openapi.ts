import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { convertOpenApiToCk } from '@maroonedsoftware/openapi-to-ck';
import type { Warning } from '@maroonedsoftware/openapi-to-ck';

interface ImportArgs {
    specPath: string;
    output: string;
    split: 'single' | 'by-tag';
}

function parseImportArgs(argv: string[]): ImportArgs {
    const args = argv.slice(3); // skip node, script, 'import-openapi'
    let specPath = '';
    let output = '.';
    let split: 'single' | 'by-tag' = 'by-tag';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--output' || arg === '-o') {
            output = args[++i] ?? '.';
        } else if (arg === '--split') {
            const val = args[++i];
            if (val === 'single' || val === 'by-tag') split = val;
        } else if (!arg.startsWith('-')) {
            specPath = arg;
        }
    }

    return { specPath, output, split };
}

export async function runImportOpenApi(): Promise<void> {
    const args = parseImportArgs(process.argv);

    if (!args.specPath) {
        console.error('Usage: dsl-compile import-openapi <spec-path> [--output <dir>] [--split single|by-tag]');
        console.error('');
        console.error('Options:');
        console.error('  -o, --output <dir>   Output directory for .ck files (default: current directory)');
        console.error('      --split <mode>   Split mode: "single" or "by-tag" (default: by-tag)');
        process.exit(1);
    }

    console.log(`Converting ${args.specPath} → .ck files...`);

    const result = await convertOpenApiToCk({
        input: resolve(args.specPath),
        split: args.split,
        includeComments: true,
        onWarning: (w: Warning) => {
            const prefix = w.severity === 'warn' ? '⚠' : 'ℹ';
            console.warn(`  ${prefix}  ${w.path}: ${w.message}`);
        },
    });

    const outputDir = resolve(args.output);
    mkdirSync(outputDir, { recursive: true });

    for (const [filename, content] of result.files) {
        const outPath = join(outputDir, filename);
        writeFileSync(outPath, content, 'utf-8');
        console.log(`  ✓  ${outPath}`);
    }

    if (result.warnings.length > 0) {
        console.log(`\n${result.warnings.length} warning(s) during conversion.`);
    }

    console.log(`\nGenerated ${result.files.size} file(s).`);
}
