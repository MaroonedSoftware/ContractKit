import { describe, expect, it } from 'vitest';
import { SCAFFOLD, generatePackageSwift } from '../src/scaffold.js';

describe('generatePackageSwift', () => {
    const out = generatePackageSwift('AcmeSdk');

    it('declares the pinned tools version on the first line, where SwiftPM reads it', () => {
        expect(out.split('\n')[0]).toBe(`// swift-tools-version:${SCAFFOLD.toolsVersion}`);
    });

    it('names the product and the target after the module', () => {
        expect(out).toContain('name: "AcmeSdk",');
        expect(out).toContain('.library(name: "AcmeSdk", targets: ["AcmeSdk"]),');
        expect(out).toContain('.target(name: "AcmeSdk"),');
    });

    it('lists every pinned platform, so a bump is one edit in SCAFFOLD', () => {
        for (const [platform, version] of Object.entries(SCAFFOLD.platforms)) {
            expect(out).toContain(`.${platform}(.${version}),`);
        }
    });

    it('says it is never regenerated, since it is written once and then owned by the user', () => {
        expect(out).toContain('never regenerated');
    });
});
