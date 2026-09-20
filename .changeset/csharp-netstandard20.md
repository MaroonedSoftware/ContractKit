---
'@contractkit/plugin-csharp': minor
---

The generated C# SDK can now be built for `netstandard2.0`, which is what a UWP or .NET Framework project can reference.

`targetFrameworks: ["netstandard2.0", "net10.0"]` adds a `Runtime/Polyfills.cs` to the output and, in a fresh scaffold, multi-targets the project file with a `System.Text.Json` reference on the old leg alone. The generated sources are the same either way — everything framework-specific sits behind `#if NETSTANDARD2_0` — and so is the public surface, so consuming code is portable across both.

Leaving the option out changes nothing. A single-framework scaffold is byte-for-byte what it was, with no package reference and a restore that needs no feed at all.

`dateTypes: "datetime"` is new alongside it: a contract's `date` maps to a `DateTime` at midnight with an unspecified kind instead of a `DateOnly`, for a UI stack whose date controls bind to that and nothing else, XAML's `DatePicker` among them. The mapping applies on every framework the SDK is built for, not only the old one, and the wire form stays `yyyy-MM-dd`. A `time` is `TimeOnly` in both modes.

Three smaller fixes went with it, and they apply on every framework:

- PATCH goes out through a verb the runtime declares itself. `HttpMethod.Patch` is the one verb the grammar allows that the framework does not spell everywhere, and no fixture had declared a PATCH operation, so no generator had golden output for it.
- The `bigint` converter no longer reads a JSON number through an overload of `Encoding.GetString` that only newer frameworks have.
- The README's `Headers` sample used `ValueTask.FromResult`, a static that arrived in .NET 5, where the constructor works everywhere.

**An existing project keeps its own `.csproj`**, which is never regenerated. Set the option, rebuild to pick up `Runtime/Polyfills.cs`, then paste the project-file snippet from the plugin's README. That README also covers what the consuming project has to set — chiefly `<LangVersion>11</LangVersion>` or higher, since a legacy UWP project defaults to C# 7.3 and cannot construct a type with `required` members.

The output tests now compile both legs with warnings as errors and round-trip every scalar through the netstandard2.0 one. No UWP or .NET Native Release build is part of that, so smoke-test one call from the app before relying on it.
