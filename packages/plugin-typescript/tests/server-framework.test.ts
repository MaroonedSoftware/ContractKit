import { describe, it, expect } from 'vitest';
import { resolveServerFramework, SERVER_FRAMEWORK_NAMES, SERVER_FRAMEWORKS, DEFAULT_SERVER_FRAMEWORK_NAME } from '../src/server-framework.js';

describe('resolveServerFramework', () => {
    it('defaults to koa when the config names none', () => {
        expect(resolveServerFramework(undefined).name).toBe('koa');
        expect(DEFAULT_SERVER_FRAMEWORK_NAME).toBe('koa');
    });

    it('resolves a supported name', () => {
        expect(resolveServerFramework('koa').name).toBe('koa');
        expect(resolveServerFramework('fastify').name).toBe('fastify');
    });

    it('rejects an unsupported name, naming what is supported', () => {
        expect(() => resolveServerFramework('express')).toThrow(/server\.framework 'express' is not supported/);
        expect(() => resolveServerFramework('express')).toThrow(/expected one of: koa/);
    });

    it('has an adapter for every declared name', () => {
        for (const name of SERVER_FRAMEWORK_NAMES) {
            expect(SERVER_FRAMEWORKS[name]?.name).toBe(name);
        }
    });
});
