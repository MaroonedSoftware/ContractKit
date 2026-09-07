/**
 * The project file a generated SDK needs to build on its own.
 *
 * Emitted with `ifAbsent`, so it is created once and then belongs to the user: a project will add a
 * package id, a version, an analyzer set and a signing key of its own, and regenerating over that
 * would throw the work away. Generated C# sources are rewritten every run; this is not.
 */

/**
 * What the scaffold pins. One object so a bump is one edit.
 *
 * There is deliberately no dependency list to go with it: the generated SDK uses only
 * `System.Text.Json` and `HttpClient` from the shared framework, so `dotnet build` restores with no
 * NuGet feed reachable at all.
 */
export const SCAFFOLD_VERSIONS = {
    targetFramework: 'net10.0',
} as const;

/**
 * Generate `<SdkName>.csproj`.
 *
 * `ImplicitUsings` is off because generated files carry an explicit `using` block of their own, and
 * leaving it on would make the output depend on the SDK's implicit set rather than on what the
 * generator wrote.
 */
export function generateCsproj(namespaceName: string, sdkName: string): string {
    return `<!-- Created once by @contractkit/plugin-csharp. Yours to edit: it is never regenerated. -->
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>${SCAFFOLD_VERSIONS.targetFramework}</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <RootNamespace>${namespaceName}</RootNamespace>
    <AssemblyName>${sdkName}</AssemblyName>
  </PropertyGroup>

</Project>
`;
}
