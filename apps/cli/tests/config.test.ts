import { mergeConfig } from '../src/config.js';
import type { DslConfig } from '../src/config.js';

describe('mergeConfig', () => {
    const baseCli = { watch: false, force: false };

    it('uses patterns from top-level patterns field', () => {
        const config: DslConfig = {
            patterns: ['contracts/**/*.ck'],
        };
        const result = mergeConfig(config, baseCli);
        expect(result.patterns).toEqual(['contracts/**/*.ck']);
    });

    it('returns empty patterns when config has no patterns', () => {
        const result = mergeConfig({}, baseCli);
        expect(result.patterns).toEqual([]);
    });

    it('resolves rootDir defaulting to cwd', () => {
        const result = mergeConfig({}, baseCli);
        expect(result.rootDir).toBeTruthy();
    });

    it('passes through force flag', () => {
        const result = mergeConfig({}, { ...baseCli, force: true });
        expect(result.force).toBe(true);
    });

    it('passes through watch flag', () => {
        const result = mergeConfig({}, { ...baseCli, watch: true });
        expect(result.watch).toBe(true);
    });

    it('resolves cache config from boolean', () => {
        const result = mergeConfig({ cache: true }, baseCli);
        expect(result.cache.enabled).toBe(true);
        expect(result.cache.filename).toBe('.contractkit-cache');
    });

    it('resolves cache config from string', () => {
        const result = mergeConfig({ cache: 'my-cache' }, baseCli);
        expect(result.cache.enabled).toBe(true);
        expect(result.cache.filename).toBe('my-cache');
    });

    it('disables cache by default', () => {
        const result = mergeConfig({}, baseCli);
        expect(result.cache.enabled).toBe(false);
    });

    it('defaults prettier to false', () => {
        const result = mergeConfig({}, baseCli);
        expect(result.prettier).toBe(false);
    });

    it('passes through prettier: true', () => {
        const result = mergeConfig({ prettier: true }, baseCli);
        expect(result.prettier).toBe(true);
    });

    it('passes through prettier: false explicitly', () => {
        const result = mergeConfig({ prettier: false }, baseCli);
        expect(result.prettier).toBe(false);
    });

    it('normalizes plugins from record format', () => {
        const config: DslConfig = {
            plugins: {
                '@contractkit/core-plugin-typescript': { server: { baseDir: 'apps/api/' } },
            },
        };
        const result = mergeConfig(config, baseCli);
        expect(result.plugins).toHaveLength(1);
        expect(result.plugins[0]!.plugin).toBe('@contractkit/core-plugin-typescript');
        expect(result.plugins[0]!.options).toEqual({ server: { baseDir: 'apps/api/' } });
    });

    it('returns empty plugins when none configured', () => {
        const result = mergeConfig({}, baseCli);
        expect(result.plugins).toEqual([]);
    });
});
