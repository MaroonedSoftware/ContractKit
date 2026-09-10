# @contractkit/plugin-csharp

## 0.1.1

### Patch Changes

- Updated dependencies [17f4261]
    - @contractkit/core@0.30.0

## 0.1.0

### Minor Changes

- 024df73: Add `@contractkit/plugin-csharp`, a C#/.NET SDK generator built on `System.Text.Json` and `HttpClient` with no NuGet dependencies, so a generated SDK restores and builds with no feed reachable.

    It emits one file of `sealed record` models per contract file and one client of `Task`-returning `...Async` methods per operation file, alongside a small runtime (`SdkHttp`, `SdkException`, `SdkOptions`, the wire converters) and an aggregator sharing one `HttpClient` across every client. `scaffold: true` writes `<SdkName>.csproj` once, as a user-owned file.

    Where it differs from the Kotlin generator it mirrors: an optional field and a required-nullable field are told apart per property (`T?` with `[JsonIgnore(WhenWritingNull)]` versus `required T?`), so a null the contract requires is written and an absent field is omitted; every tuple is hoisted with a type-level converter, so one nested in a collection still travels as a JSON array; a discriminated union is a marker interface its member records implement, so one contract can belong to several unions; and the generated output is compiled by `dotnet build` in the cross-plugin test suite wherever a .NET SDK is installed.
