import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const isWatch = process.argv.includes('--watch');

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'es2022',
  format: 'esm',
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

function copyGrammar() {
  const src = resolve(__dirname, '../../packages/contractkit/dist/contract-dsl.ohm');
  const dest = resolve(__dirname, 'dist/server/contract-dsl.ohm');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

if (isWatch) {
  const [clientCtx, serverCtx] = await Promise.all([esbuild.context(clientConfig), esbuild.context(serverConfig)]);
  await Promise.all([clientCtx.watch(), serverCtx.watch()]);
  copyGrammar();
  console.log('Watching for changes...');
} else {
  await Promise.all([esbuild.build(clientConfig), esbuild.build(serverConfig)]);
  copyGrammar();
  console.log('Build complete.');
}
