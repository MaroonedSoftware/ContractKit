import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { convertOpenApiToCk } from './convert.js';
import type { Warning } from './types.js';
import type { ContractKitPlugin, CommandContext } from '@maroonedsoftware/contractkit';

interface ImportArgs {
    specPath: string;
    output: string;
    split: 'single' | 'by-tag';
}

function parseImportArgs(argv: string[]): ImportArgs {
    let specPath = '';
    let output = '.';
    let split: 'single' | 'by-tag' = 'by-tag';

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--output' || arg === '-o') {
            output = argv[++i] ?? '.';
        } else if (arg === '--split') {
            const val = argv[++i];
            if (val === 'single' || val === 'by-tag') split = val;
        } else if (!arg.startsWith('-')) {
            specPath = arg;
        }
    }

    return { specPath, output, split };
}

const plugin: ContractKitPlugin = {
    name: 'import-openapi',
    command: {
        name: 'import-openapi',
        description: 'Convert an OpenAPI YAML file to .ck contracts',
        async run(args: string[], _ctx: CommandContext): Promise<void> {
            const parsed = parseImportArgs(args);

            if (!parsed.specPath) {
                console.error('Usage: contractkit import-openapi <spec-path> [--output <dir>] [--split single|by-tag]');
                console.error('');
                console.error('Options:');
                console.error('  -o, --output <dir>   Output directory for .ck files (default: current directory)');
                console.error('      --split <mode>   Split mode: "single" or "by-tag" (default: by-tag)');
                process.exit(1);
            }

            console.log(`Converting ${parsed.specPath} → .ck files...`);

            const result = await convertOpenApiToCk({
                input: resolve(parsed.specPath),
                split: parsed.split,
                includeComments: true,
                onWarning: (w: Warning) => {
                    const prefix = w.severity === 'warn' ? '⚠' : 'ℹ';
                    console.warn(`  ${prefix}  ${w.path}: ${w.message}`);
                },
            });

            const outputDir = resolve(parsed.output);
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
        },
    },
};

export default plugin;
