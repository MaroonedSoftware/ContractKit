import { mergeConfig } from '../src/config.js';
import type { DslConfig } from '../src/config.js';

describe('mergeConfig', () => {
  const baseCli = { patterns: [] as string[], watch: false, force: false };

  it('uses config values when CLI args are empty', () => {
    const config: DslConfig = { outDir: 'dist', patterns: ['src/**/*.dto'] };
    const result = mergeConfig(config, baseCli);
    expect(result.outDir).toBe('dist');
    expect(result.patterns).toEqual(['src/**/*.dto']);
  });

  it('CLI args override config values', () => {
    const config: DslConfig = { outDir: 'dist', patterns: ['src/**/*.dto'] };
    const result = mergeConfig(config, { ...baseCli, patterns: ['other/**/*.dto'], outDir: 'out' });
    expect(result.outDir).toBe('out');
    expect(result.patterns).toEqual(['other/**/*.dto']);
  });

  it('CLI service path overrides config', () => {
    const config: DslConfig = { servicePathTemplate: '#old/{kebab}.js' };
    const result = mergeConfig(config, { ...baseCli, servicePath: '#new/{kebab}.js' });
    expect(result.servicePathTemplate).toBe('#new/{kebab}.js');
  });

  it('preserves config servicePathTemplate when CLI has none', () => {
    const config: DslConfig = { servicePathTemplate: '#svc/{kebab}.js' };
    const result = mergeConfig(config, baseCli);
    expect(result.servicePathTemplate).toBe('#svc/{kebab}.js');
  });

  it('returns empty patterns when neither config nor CLI provides them', () => {
    const result = mergeConfig({}, baseCli);
    expect(result.patterns).toEqual([]);
  });

  it('passes through force flag', () => {
    const result = mergeConfig({}, { ...baseCli, force: true });
    expect(result.force).toBe(true);
  });
});
