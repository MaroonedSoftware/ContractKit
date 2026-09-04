import { describe, it, expect } from 'vitest';
import { SECURITY_NONE } from '@contractkit/core';
import { policyGuard, signatureGuard, canonicalSecurity } from '../src/route-guards.js';
import { KOA_SERVER_FRAMEWORK as koa } from '../src/server-framework-koa.js';
import { FASTIFY_SERVER_FRAMEWORK as fastify } from '../src/server-framework-fastify.js';
import { loc } from './helpers.js';

describe('policyGuard', () => {
    it('takes the runtime default when the operation declares no security', () => {
        expect(policyGuard(koa, undefined)).toBe('requirePolicy()');
    });

    it('emits no guard at all for security: none', () => {
        expect(policyGuard(koa, SECURITY_NONE)).toBeUndefined();
    });

    it('passes a named policy through', () => {
        expect(policyGuard(koa, { policy: 'payments.write', loc: loc() })).toBe("requirePolicy({ policy: 'payments.write' })");
    });

    it('distinguishes an explicit false from an absent policy', () => {
        expect(policyGuard(koa, { policy: false, loc: loc() })).toBe('requirePolicy({ policy: false })');
        expect(policyGuard(koa, { loc: loc() })).toBe('requirePolicy()');
    });

    it('escapes a quote in the policy name rather than closing the literal', () => {
        expect(policyGuard(koa, { policy: "pol'y", loc: loc() })).toBe("requirePolicy({ policy: 'pol\\'y' })");
    });

    it('renders through whichever adapter it is given', () => {
        // Both frameworks spell the call the same way; only where it lands in a route differs.
        expect(policyGuard(fastify, { policy: 'x', loc: loc() })).toBe("requirePolicy({ policy: 'x' })");
    });
});

describe('signatureGuard', () => {
    it('renders the bare form when there is no signature policy', () => {
        expect(signatureGuard(koa, 'WEBHOOK')).toBe("requireSignature('WEBHOOK')");
    });

    it('renders the block form with its policy', () => {
        expect(signatureGuard(koa, 'SLACK', 'slackSignatureValid')).toBe("requireSignature('SLACK', { policy: 'slackSignatureValid' })");
    });

    it('escapes quotes in both arguments', () => {
        expect(signatureGuard(koa, "sig'v", "pol'y")).toBe("requireSignature('sig\\'v', { policy: 'pol\\'y' })");
    });
});

describe('canonicalSecurity', () => {
    it('folds the forms two declarations can be compared by', () => {
        expect(canonicalSecurity(undefined)).toBe('undeclared');
        expect(canonicalSecurity(SECURITY_NONE)).toBe('none');
        expect(canonicalSecurity({ loc: loc() })).toBe('undeclared');
        expect(canonicalSecurity({ policy: false, loc: loc() })).toBe('policy=false');
        expect(canonicalSecurity({ policy: 'x', loc: loc() })).toBe('policy=x');
    });

    it('ignores the comments that sit alongside the policy', () => {
        const a = { policy: 'x', policyDescription: 'why', loc: loc() };
        const b = { policy: 'x', leadingComments: ['// why'], loc: loc() };
        expect(canonicalSecurity(a)).toBe(canonicalSecurity(b));
    });
});
