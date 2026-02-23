import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    sourcemap: true,
    minify: false,
    external: ['vscode'],
};

const clientConfig = {
    ...shared,
    entryPoints: ['src/client/extension.ts'],
    outfile: 'dist/client/extension.js',
};

const serverConfig = {
    ...shared,
    entryPoints: ['src/server/server.ts'],
    outfile: 'dist/server/server.js',
};

if (isWatch) {
    const [clientCtx, serverCtx] = await Promise.all([
        esbuild.context(clientConfig),
        esbuild.context(serverConfig),
    ]);
    await Promise.all([clientCtx.watch(), serverCtx.watch()]);
    console.log('Watching for changes...');
} else {
    await Promise.all([
        esbuild.build(clientConfig),
        esbuild.build(serverConfig),
    ]);
    console.log('Build complete.');
}
