import { mergeConfig } from '../src/config.js';
import type { DslConfig } from '../src/config.js';

describe('mergeConfig', () => {
  const baseCli = { watch: false, force: false };

  it('collects patterns from server types, routes, sdk, and top-level patterns', () => {
    const config: DslConfig = {
      server: {
        types: { include: ['types/**/*.dto'] },
        routes: { include: ['ops/**/*.op'] },
      },
      sdk: {
        types: { include: ['sdk-types/**/*.dto'] },
        clients: { include: ['sdk-ops/**/*.op'] },
      },
      patterns: ['extra/**/*.dto'],
    };
    const result = mergeConfig(config, baseCli);
    expect(result.patterns).toEqual([
      'types/**/*.dto',
      'ops/**/*.op',
      'sdk-types/**/*.dto',
      'sdk-ops/**/*.op',
      'extra/**/*.dto',
    ]);
  });

  it('returns empty patterns when config has no includes', () => {
    const result = mergeConfig({}, baseCli);
    expect(result.patterns).toEqual([]);
  });

  it('resolves rootDir defaulting to cwd', () => {
    const result = mergeConfig({}, baseCli);
    expect(result.rootDir).toBeTruthy();
  });

  it('passes through server config with defaults', () => {
    const config: DslConfig = {
      server: {
        baseDir: 'apps/api/',
        routes: { servicePathTemplate: '#modules/{module}/{module}.service.js' },
      },
    };
    const result = mergeConfig(config, baseCli);
    expect(result.server.baseDir).toBe('apps/api/');
    expect(result.server.routes.servicePathTemplate).toBe('#modules/{module}/{module}.service.js');
  });

  it('passes through force flag', () => {
    const result = mergeConfig({}, { ...baseCli, force: true });
    expect(result.force).toBe(true);
  });

  it('passes through watch flag', () => {
    const result = mergeConfig({}, { ...baseCli, watch: true });
    expect(result.watch).toBe(true);
  });

  it('passes through sdk config', () => {
    const config: DslConfig = {
      sdk: {
        baseDir: 'packages/sdk/',
        name: 'myapp',
        output: 'src/{name}.sdk.ts',
      },
    };
    const result = mergeConfig(config, baseCli);
    expect(result.sdk?.baseDir).toBe('packages/sdk/');
    expect(result.sdk?.name).toBe('myapp');
    expect(result.sdk?.output).toBe('src/{name}.sdk.ts');
  });

  it('resolves cache config from boolean', () => {
    const result = mergeConfig({ cache: true }, baseCli);
    expect(result.cache.enabled).toBe(true);
    expect(result.cache.filename).toBe('.contract-dsl-cache');
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
});
