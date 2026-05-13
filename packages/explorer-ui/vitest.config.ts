import { defineProject } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineProject({
    test: {
        globals: true,
        include: ['./tests/**/*.test.ts'],
        environment: 'node',
        testTimeout: 50000,
        hookTimeout: 30000,
        fileParallelism: true,
    },
    plugins: [swc.vite()],
});
