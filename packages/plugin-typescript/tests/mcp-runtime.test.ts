import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { z } from 'zod';
import { dirname, join } from 'node:path';
import { computeModelsWithInput, computeModelsWithOutput, decomposeCk, DiagnosticCollector, parseCk } from '@contractkit/core';
import { createTypescriptPlugin, type McpConfig } from '../src/index.js';

/**
 * Generated MCP tools, run. A small loader evaluates the emitted server types and tools file with
 * stand-ins for ServerKit and injectkit, which this package does not install, and real zod. Each
 * tool is called the way `McpServerFactory` calls it: `handle(args, context)`, its result handed
 * back to the client untouched.
 */

// ─── The contract under test ───────────────────────────────────────────────

const SOURCE = `
contract Thing: {
    name: string
}

operation /things: {
    get: {
        sdk: listThings
        mcp: true
        service: ThingService.list
        response: {
            200: { application/json: array(Thing) }
        }
    }
}

operation /things/maybe: {
    get: {
        sdk: maybeThing
        mcp: true
        service: ThingService.maybe
        response: {
            200: { application/json: Thing | null }
        }
    }
}

operation /things/label: {
    get: {
        sdk: thingLabel
        mcp: true
        service: ThingService.label
        response: {
            200: { application/json: string }
        }
    }
}
`;

// ─── Running the emitted files ─────────────────────────────────────────────

interface CallToolResult {
    content: { type: string; text: string }[];
    structuredContent?: unknown;
}
interface Tool {
    definition: { name: string; outputSchema?: { type?: string } };
    handle(args: Record<string, unknown>, context: object): Promise<CallToolResult>;
}
type ToolClass = new (...deps: unknown[]) => Tool;

/** Everything the plugin emits for {@link SOURCE}, keyed by absolute path. */
async function emit(mcp: McpConfig = {}): Promise<Map<string, string>> {
    const diag = new DiagnosticCollector();
    const { contract, op } = decomposeCk(parseCk(SOURCE, '/project/contracts/things.ck', diag));
    expect(diag.getAll().filter(d => d.severity === 'error')).toEqual([]);
    const plugin = createTypescriptPlugin(
        {
            server: { zod: true, output: { routes: 'server/routes/{filename}.router.ts', types: 'server/types/{filename}.ts' } },
            mcp: { baseDir: 'server', emitRouter: false, ...mcp },
        },
        '/project',
    );
    const emitted = new Map<string, string>();
    await plugin.generateTargets!(
        {
            contractRoots: [contract],
            opRoots: [op],
            modelOutPaths: new Map(),
            modelsWithInput: computeModelsWithInput(contract.models),
            modelsWithOutput: computeModelsWithOutput(contract.models),
        },
        {
            rootDir: '/project',
            options: {},
            cacheEnabled: false,
            cacheDir: '/project/.contractkit/cache',
            emitFile: (path: string, content: string) => emitted.set(path, content),
            warn: () => {},
        },
    );
    return emitted;
}

/** A CommonJS loader over the emitted files, with every package they import stood in for. */
function loader(files: Map<string, string>) {
    const externals: Record<string, unknown> = {
        zod: { z },
        injectkit: { Injectable: () => (target: unknown) => target },
        '@maroonedsoftware/mcp': {
            requireMcpPolicy: async (context: { authenticationSession?: unknown }) => {
                if (!context.authenticationSession) throw new Error('401');
                return context.authenticationSession;
            },
        },
        '@maroonedsoftware/policies': { PolicyService: class {} },
        '@maroonedsoftware/authentication': { MFA_SATISFIED_POLICY: 'mfa.satisfied' },
        '@maroonedsoftware/zod': { parseAndValidate: async (value: unknown, schema: z.ZodType) => schema.parse(value) },
        '@maroonedsoftware/utilities': { bigIntReplacer: (_: string, v: unknown) => v },
    };
    const services = { ThingService: class {} };
    const cache = new Map<string, Record<string, unknown>>();
    const load = (path: string): Record<string, unknown> => {
        const cached = cache.get(path);
        if (cached) return cached;
        const source = files.get(path);
        expect(source, `nothing emitted at ${path}`).toBeDefined();
        const js = ts.transpileModule(source!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        const module = { exports: {} as Record<string, unknown> };
        cache.set(path, module.exports);
        const require = (spec: string): unknown => {
            if (spec.startsWith('.')) return load(join(dirname(path), spec.replace(/\.js$/, '.ts')));
            if (spec in externals) return externals[spec];
            if (/service/.test(spec)) return services;
            throw new Error(`unexpected import '${spec}' from ${path}`);
        };
        new Function('require', 'exports', 'module', js)(require, module.exports, module);
        return module.exports;
    };
    return load;
}

/** The emitted tools file's exports. */
async function tools(mcp?: McpConfig): Promise<Record<string, unknown>> {
    const files = await emit(mcp);
    const path = [...files.keys()].find(p => p.endsWith('things.mcp.ts'));
    expect(path, `no tools file among ${[...files.keys()].join(', ')}`).toBeDefined();
    return loader(files)(path!);
}

const session = { authenticationSession: { subject: 'user-1' } };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('a generated MCP tool whose result is not an object', () => {
    const service = {
        list: async () => [{ name: 'a' }, { name: 'b' }],
        maybe: async () => null,
        label: async () => 'widget',
    };
    const call = async (className: string) => {
        const Tool = (await tools())[className] as ToolClass;
        const tool = new Tool(service, {});
        return { tool, result: await tool.handle({}, session) };
    };

    it('reports a list as { items }', async () => {
        const { tool, result } = await call('ListThingsMcpTool');
        expect(tool.definition.outputSchema?.type).toBe('object');
        expect(result.structuredContent).toEqual({ items: [{ name: 'a' }, { name: 'b' }] });
        expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    });

    it('reports null as { value: null }', async () => {
        const { tool, result } = await call('MaybeThingMcpTool');
        expect(tool.definition.outputSchema?.type).toBe('object');
        expect(result.structuredContent).toEqual({ value: null });
    });

    it('reports a string as { value }', async () => {
        const { tool, result } = await call('ThingLabelMcpTool');
        expect(tool.definition.outputSchema?.type).toBe('object');
        expect(result.structuredContent).toEqual({ value: 'widget' });
        expect(result.content[0]!.text).toBe('{"value":"widget"}');
    });
});
