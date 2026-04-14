import { resolve, basename } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { generateOpenCollection } from './codegen-bruno.js';
import type { OpenApiSecurityScheme } from '@maroonedsoftware/contractkit';
import type { ContractKitPlugin } from '@maroonedsoftware/contractkit';

export interface BrunoPluginConfig {
    baseDir?: string;
    output?: string;
    collectionName?: string;
}

export interface BrunoPluginOptions extends BrunoPluginConfig {
    auth?: { defaultScheme: string; schemes?: Record<string, OpenApiSecurityScheme> };
}

// ─── Default export: loaded via plugins array, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'bruno',
    cacheKey: 'bruno',
    async generateTargets({ opRoots, contractRoots }, ctx) {
        const { auth, ...config } = ctx.options as BrunoPluginOptions;
        const base = config.baseDir ? resolve(ctx.rootDir, config.baseDir) : ctx.rootDir;
        const outDir = resolve(base, config.output ?? 'bruno-collection');
        const collectionName = config.collectionName ?? basename(ctx.rootDir);

        if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

        const files = generateOpenCollection(opRoots, { collectionName, contractRoots, auth });
        for (const { relativePath, content } of files) {
            ctx.emitFile(resolve(outDir, relativePath), content);
        }
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

export function createBrunoPlugin(
    config: BrunoPluginConfig,
    rootDir: string,
    auth?: { defaultScheme: string; schemes?: Record<string, OpenApiSecurityScheme> },
): ContractKitPlugin {
    return {
        name: 'bruno',
        cacheKey: `bruno:${JSON.stringify(config)}`,
        async generateTargets({ opRoots, contractRoots }, ctx) {
            const base = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
            const outDir = resolve(base, config.output ?? 'bruno-collection');
            const collectionName = config.collectionName ?? basename(rootDir);

            // Clean stale output directory before regenerating
            if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

            const files = generateOpenCollection(opRoots, { collectionName, contractRoots, auth });
            for (const { relativePath, content } of files) {
                ctx.emitFile(resolve(outDir, relativePath), content);
            }
        },
    };
}
