import { describe, it, expect } from 'vitest';
import { generateOp } from '../src/codegen-operation.js';
import type { ServerFramework } from '../src/server-framework.js';
import { scalarType, refType, opParam, opRequest, opMultiRequest, opResponse, opResponseMulti, opOperation, opRoute, opRoot } from './helpers.js';

/**
 * A framework whose every string is unmistakable. Rendering a router through it and finding no Koa
 * left in the output is what proves the seam is complete: a `ctx.` the generator still emits inline
 * would survive this substitution, and a `toContain` test against the Koa output never notices,
 * because the default adapter puts the very same string there.
 */
const STUB: ServerFramework = {
    // The registry's key type admits only shipped frameworks; the adapter under test is a fake.
    name: 'koa',
    imports: uses => (uses('StubRouter') ? ["import { StubRouter } from '@stub/http';"] : []),
    routerDeclaration: routerName => `export const ${routerName} = StubRouter();`,
    pathParam: identifier => `<${identifier}>`,
    handlerLocals: ['rq', 'rs'],
    routeOpen: (routerName, method, path, middlewares) => `${routerName}.route('${method}', '${path}', [${middlewares.join(', ')}], async (rq, rs) => {`,
    routeClose: () => ['}, END);'],
    middleware: {
        policy: args => `stubPolicy(${args})`,
        bodyParser: tokens => `stubBody(${tokens})`,
        signature: args => `stubSignature(${args})`,
    },
    request: {
        params: 'rq.pathParams',
        query: 'rq.searchParams',
        headers: 'rq.headerBag',
        parsedBody: 'rq.payload',
        contentType: 'rq.mediaType',
    },
    resolveService: className => `rq.services.resolve(${className})`,
    response: {
        status: expr => `rs.setStatus(${expr});`,
        header: (name, valueExpr) => `rs.putHeader('${name}', ${valueExpr});`,
        type: expr => `rs.setMedia(${expr});`,
        send: bodyExpr => (bodyExpr === undefined ? ['return rs.finish();'] : [`return rs.deliver(${bodyExpr});`]),
        caseEnd: () => [],
    },
    mcpRouter: ({ path }) => `// stub mcp at ${path}\n`,
};

/** One op root touching every branch of the generator that can emit a framework string. */
function everyBranchRoot() {
    return opRoot([
        opRoute(
            '/payments/{paymentId}',
            [
            // Path params + query + headers + a single JSON body, with policy and signature middleware.
            opOperation('post', {
                request: opRequest('Payment'),
                query: [opParam('limit', scalarType('int'))],
                headers: [opParam('x-tenant', scalarType('string'))],
                signature: 'stripe',
                responses: [opResponse(201, 'Payment')],
            }),
            // Several request MIMEs with different shapes — the content-type switch.
            opOperation('put', {
                request: opMultiRequest([
                    ['application/json', 'Payment'],
                    ['multipart/form-data', 'Receipt'],
                ]),
                responses: [opResponse(200, 'Payment')],
            }),
            // No emitted body at all — the bodyless 204 path.
            opOperation('delete', { responses: [] }),
            // Several emitted statuses, one carrying response headers — the status switch.
            opOperation('patch', {
                responses: [
                    opResponseMulti(200, [{ contentType: 'application/json', bodyType: 'Payment' }], {
                        headers: [{ name: 'etag', optional: false, type: scalarType('string') }],
                    }),
                    opResponseMulti(202, [{ contentType: 'application/json', bodyType: refType('Payment') }], {
                        headers: [{ name: 'retry-after', optional: true, type: scalarType('string') }],
                    }),
                ],
            }),
            ],
            [opParam('paymentId', scalarType('uuid'))],
        ),
    ]);
}

describe('generateOp — framework seam', () => {
    const output = generateOp(everyBranchRoot(), { framework: STUB });

    it('leaves no Koa string anywhere in the output', () => {
        expect(output).not.toMatch(/\bctx\b/);
        expect(output).not.toContain('ServerKitRouter');
        expect(output).not.toContain('@maroonedsoftware/koa');
        expect(output).not.toContain('requirePolicy');
        expect(output).not.toContain('bodyParserMiddleware');
        expect(output).not.toContain('requireSignature');
    });

    it('renders the router shell through the adapter', () => {
        expect(output).toContain('export const UsersRouter = StubRouter();');
        expect(output).toContain("import { StubRouter } from '@stub/http';");
        expect(output).toContain('}, END);');
    });

    it('renders the route line, its path params and its middleware through the adapter', () => {
        expect(output).toContain("UsersRouter.route('post', '/payments/<paymentId>', [stubPolicy(), stubBody('json'), stubSignature('stripe')], async (rq, rs) => {");
    });

    it('reads params, query, headers and the body through the adapter', () => {
        expect(output).toContain('rq.pathParams');
        expect(output).toContain('rq.searchParams');
        expect(output).toContain('rq.headerBag');
        expect(output).toContain('rq.payload');
        expect(output).toContain('switch (rq.mediaType) {');
    });

    it('resolves services through the adapter', () => {
        expect(output).toContain('rq.services.resolve(UsersService)');
    });

    it('writes status, headers, content type and body through the adapter', () => {
        expect(output).toContain('rs.setStatus(201);');
        expect(output).toContain("rs.setMedia('application/json');");
        expect(output).toContain('return rs.deliver(result);');
        expect(output).toContain('rs.putHeader(\'etag\', String(result.headers["etag"]));');
        expect(output).toContain('if (result.headers["retryAfter"] !== undefined) rs.putHeader(\'retry-after\', String(result.headers["retryAfter"]));');
    });

    it('gives a bodyless response the adapter\'s terminal statement', () => {
        // Koa needs none, so the generator only emits one because the adapter asked for it.
        expect(output).toContain('rs.setStatus(204);');
        expect(output).toContain('return rs.finish();');
    });

    it('omits the status-case terminator when the adapter has none', () => {
        expect(output).toContain('rs.setStatus(result.status);');
        // Scoped to the status switch: the multi-MIME request dispatch is the generator's own control
        // flow and keeps its `break;` whatever the framework is.
        const statusSwitch = output.slice(output.indexOf('switch (result.status) {'));
        expect(statusSwitch).toContain('case 202:');
        expect(statusSwitch).not.toContain('break;');
    });
});
