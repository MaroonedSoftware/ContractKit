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

    it('keeps the single-framework output identical however the one framework is spelled', () => {
        expect(generateCsproj('Acme.Sdk', 'AcmeSdk', ['net10.0'])).toBe(generateCsproj('Acme.Sdk', 'AcmeSdk'));
    });

    it('multi-targets, pins the language version and references System.Text.Json for netstandard2.0', () => {
        const out = generateCsproj('Acme.Sdk', 'AcmeSdk', ['netstandard2.0', 'net10.0']);
        expect(out).toContain('<TargetFrameworks>netstandard2.0;net10.0</TargetFrameworks>');
        expect(out).not.toContain('<TargetFramework>');
        // Both conditioned on the old framework, so net10.0 keeps its default language version and
        // its dependency-free restore.
        expect(out).toContain(`<PropertyGroup Condition="'$(TargetFramework)' == 'netstandard2.0'">`);
        expect(out).toContain(`<LangVersion>${SCAFFOLD_VERSIONS.netstandardLangVersion}</LangVersion>`);
        expect(out).toContain(`<ItemGroup Condition="'$(TargetFramework)' == 'netstandard2.0'">`);
        expect(out).toContain(`<PackageReference Include="System.Text.Json" Version="${SCAFFOLD_VERSIONS.systemTextJson}" />`);
    });

    it('can target netstandard2.0 on its own', () => {
        const out = generateCsproj('Acme.Sdk', 'AcmeSdk', ['netstandard2.0']);
        expect(out).toContain('<TargetFramework>netstandard2.0</TargetFramework>');
        expect(out).toContain('<PackageReference Include="System.Text.Json"');
    });
});
