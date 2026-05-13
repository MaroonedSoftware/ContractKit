import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const isWatch = process.argv.includes('--watch');

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const sharedNode = {
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'esm',
    sourcemap: true,
    minify: false,
    external: ['vscode'],
    // Bundled CJS dependencies (e.g. vscode-languageserver) call `require("node:util")` etc.
    // In ESM output esbuild routes those through a shim that throws "Dynamic require ... not supported";
    // this banner replaces the shim with a real `require` so node: built-ins resolve normally.
    banner: {
        js: "import { createRequire as __createRequireForCkExt } from 'node:module'; const require = __createRequireForCkExt(import.meta.url);",
    },
};

const clientConfig = {
    ...sharedNode,
    entryPoints: ['src/client/extension.ts'],
    outfile: 'dist/client/extension.js',
};

const serverConfig = {
    ...sharedNode,
    entryPoints: ['src/server/server.ts'],
    outfile: 'dist/server/server.js',
};

/** Webview bundle — must NOT inherit the Node `createRequire` banner. */
const webviewConfig = {
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview/main.js',
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    sourcemap: true,
    minify: false,
};

function copyGrammar() {
    const src = resolve(__dirname, '../../packages/contractkit/dist/contractkit.ohm');
    const dest = resolve(__dirname, 'dist/server/contractkit.ohm');
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
}

function copyWebviewAssets() {
    const destDir = resolve(__dirname, 'dist/webview');
    mkdirSync(destDir, { recursive: true });
    copyFileSync(
        resolve(__dirname, '../../packages/explorer-ui/dist/assets/style.css'),
        resolve(destDir, 'base.css'),
    );
    copyFileSync(resolve(__dirname, 'src/webview/style.css'), resolve(destDir, 'theme.css'));
}

const copyAssetsPlugin = {
    name: 'copy-webview-assets',
    setup(build) {
        build.onEnd(() => {
            try {
                copyWebviewAssets();
            } catch (err) {
                console.error('Failed to copy webview assets:', err);
            }
        });
    },
};

if (isWatch) {
    const [clientCtx, serverCtx, webviewCtx] = await Promise.all([
        esbuild.context(clientConfig),
        esbuild.context(serverConfig),
        esbuild.context({ ...webviewConfig, plugins: [copyAssetsPlugin] }),
    ]);
    await Promise.all([clientCtx.watch(), serverCtx.watch(), webviewCtx.watch()]);
    copyGrammar();
    copyWebviewAssets();
    console.log('Watching for changes...');
} else {
    await Promise.all([
        esbuild.build(clientConfig),
        esbuild.build(serverConfig),
        esbuild.build(webviewConfig),
    ]);
    copyGrammar();
    copyWebviewAssets();
    console.log('Build complete.');
}
