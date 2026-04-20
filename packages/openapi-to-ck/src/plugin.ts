import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { convertOpenApiToCk } from './convert.js';
import type { Warning } from './types.js';
import type { ContractKitPlugin, CommandContext } from '@contractkit/core';

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

const USAGE = `Usage: contractkit import-openapi <spec-path> [options]

Convert an OpenAPI 2.0/3.0/3.1 YAML or JSON spec into .ck contract files.

Arguments:
  <spec-path>          Path to the OpenAPI spec file

Options:
  -o, --output <dir>   Output directory for .ck files (default: current directory)
      --split <mode>   How to split output: "by-tag" (one file per tag) or "single" (default: by-tag)
  -h, --help           Show this help message`;

const plugin: ContractKitPlugin = {
    name: 'import-openapi',
    command: {
        name: 'import-openapi',
        description: 'Convert an OpenAPI YAML/JSON spec to .ck contracts',
        usage: USAGE,
        async run(args: string[], _ctx: CommandContext): Promise<void> {
            const parsed = parseImportArgs(args);

            if (!parsed.specPath) {
                console.error(USAGE);
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
