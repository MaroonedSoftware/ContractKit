/**
 * The project file a generated SDK needs to build on its own.
 *
 * Emitted with `ifAbsent`, so it is created once and then belongs to the user: a project will add a
 * package id, a version, an analyzer set and a signing key of its own, and regenerating over that
 * would throw the work away. Generated C# sources are rewritten every run; this is not. A project
 * created before a scaffold change therefore keeps its own file — the README carries the snippet to
 * paste when the change is one the project wants.
 */

/** The frameworks a generated SDK can be built for. */
export type CSharpTargetFramework = 'netstandard2.0' | 'net10.0';

/**
 * What the scaffold pins. One object so a bump is one edit.
 *
 * A single-framework SDK on `net10.0` has no dependency list to go with it: it uses only
 * `System.Text.Json` and `HttpClient` from the shared framework, so `dotnet build` restores with no
 * NuGet feed reachable at all. `netstandard2.0` is the exception — `System.Text.Json` is a package
 * there, and one that brings `System.Memory` and `System.Threading.Tasks.Extensions` with it.
 */
export const SCAFFOLD_VERSIONS = {
    targetFramework: 'net10.0',
    systemTextJson: '10.0.12',
    /** The oldest language version the generated sources compile under: records, `required`, primary constructors. */
    netstandardLangVersion: '12.0',
} as const;

/** The framework the scaffold targets when the config names none. */
export const DEFAULT_TARGET_FRAMEWORKS: readonly CSharpTargetFramework[] = [SCAFFOLD_VERSIONS.targetFramework];

/**
 * Generate `<SdkName>.csproj`.
 *
 * `ImplicitUsings` is off because generated files carry an explicit `using` block of their own, and
 * leaving it on would make the output depend on the SDK's implicit set rather than on what the
 * generator wrote.
 *
 * Only a build that includes `netstandard2.0` pins `LangVersion` or references a package. On its own,
 * `net10.0` defaults to the newest language version the SDK knows, and pinning one here would hold a
 * project back rather than help it.
 */
export function generateCsproj(
    namespaceName: string,
    sdkName: string,
    targetFrameworks: readonly CSharpTargetFramework[] = DEFAULT_TARGET_FRAMEWORKS,
): string {
    const frameworks =
        targetFrameworks.length === 1
            ? `    <TargetFramework>${targetFrameworks[0]}</TargetFramework>`
            : `    <TargetFrameworks>${targetFrameworks.join(';')}</TargetFrameworks>`;

    const netstandard = targetFrameworks.includes('netstandard2.0')
        ? `
  <!-- .NET Standard 2.0 predates the language features the generated sources use. -->
  <PropertyGroup Condition="'$(TargetFramework)' == 'netstandard2.0'">
    <LangVersion>${SCAFFOLD_VERSIONS.netstandardLangVersion}</LangVersion>
  </PropertyGroup>

  <!-- The one framework where System.Text.Json is a package rather than part of the platform. -->
  <ItemGroup Condition="'$(TargetFramework)' == 'netstandard2.0'">
    <PackageReference Include="System.Text.Json" Version="${SCAFFOLD_VERSIONS.systemTextJson}" />
  </ItemGroup>
`
        : '';

    return `<!-- Created once by @contractkit/plugin-csharp. Yours to edit: it is never regenerated. -->
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
${frameworks}
    <Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <RootNamespace>${namespaceName}</RootNamespace>
    <AssemblyName>${sdkName}</AssemblyName>
  </PropertyGroup>
${netstandard}
</Project>
`;
}
