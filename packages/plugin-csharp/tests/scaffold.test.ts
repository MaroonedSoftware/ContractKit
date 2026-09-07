import { describe, expect, it } from 'vitest';
import { SCAFFOLD_VERSIONS, generateCsproj } from '../src/scaffold.js';

describe('generateCsproj', () => {
    it('targets the pinned framework', () => {
        expect(generateCsproj('Acme.Sdk', 'AcmeSdk')).toContain(`<TargetFramework>${SCAFFOLD_VERSIONS.targetFramework}</TargetFramework>`);
    });

    it('takes the namespace and assembly name from config', () => {
        const out = generateCsproj('Acme.Sdk', 'AcmeSdk');
        expect(out).toContain('<RootNamespace>Acme.Sdk</RootNamespace>');
        expect(out).toContain('<AssemblyName>AcmeSdk</AssemblyName>');
    });

    it('enables nullable and disables implicit usings, which generated files declare for themselves', () => {
        const out = generateCsproj('Acme.Sdk', 'AcmeSdk');
        expect(out).toContain('<Nullable>enable</Nullable>');
        expect(out).toContain('<ImplicitUsings>disable</ImplicitUsings>');
    });

    it('declares no package reference, so the SDK restores with no NuGet feed reachable', () => {
        expect(generateCsproj('Acme.Sdk', 'AcmeSdk')).not.toContain('PackageReference');
    });

    it('says it is never regenerated, since the file is the user’s after the first run', () => {
        expect(generateCsproj('Acme.Sdk', 'AcmeSdk')).toContain('never regenerated');
    });
});
