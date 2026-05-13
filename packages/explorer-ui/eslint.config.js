//  @ts-check

import base from '@repo/config-eslint/base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...base,
    {
        files: ['src/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@contractkit/core',
                            message:
                                'Use `import type { ... } from "@contractkit/core"` only — runtime imports would bloat the consumer bundles (e.g. the VS Code webview IIFE).',
                            allowTypeImports: true,
                        },
                    ],
                },
            ],
        },
    },
];
