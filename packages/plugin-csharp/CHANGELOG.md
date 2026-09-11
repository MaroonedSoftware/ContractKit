# @contractkit/plugin-csharp

## 0.1.5

### Patch Changes

- 153134e: A default on a `bigint` field is parsed as an exact `bigint`, and the generated TypeScript for one compiles.

    `quantity: bigint = 9007199254740993` used to parse to the JS number `9007199254740992`, so every generator emitted the rounded value and `pnpm format` wrote it back into the file. The parser now reads the literal's digits into a `bigint`, for a `bigint` field or a `bigint | null` one. A non-integer default such as `= 1.5` is reported as an error instead. `FieldNode.default` and `OpParamNode.default` are typed `FieldDefault`, which adds `bigint`, so plugins that read a default have one more case to handle. The new `coerceDefault` export applies the rule.

    The TypeScript plugin wrote a bigint default as `.default(5)`. Zod requires a default to be the schema's output type, so every generated project with a bigint default failed to typecheck (TS2769). At runtime the handler would also have received a `number`, because Zod returns a default without parsing it. It now writes `.default(5n)`.

    Every other consumer handles the new value: Kotlin, Swift and C# initialize from the exact digits, Bruno and the `openapi` target write the digit string a `bigint` travels as, `openapi-to-ck` reads that string back with `BigInt()` rather than `Number()`, and the VS Code hover no longer throws when a referenced model carries a bigint default.

    A default on a field whose type is a `ref` to a `bigint` alias is still parsed as a number, because the alias is not resolved at parse time.

- Updated dependencies [a440886]
- Updated dependencies [153134e]
    - @contractkit/core@0.31.0

## 0.1.4

### Patch Changes

- 6f8f55b: Fix two naming collisions that made the generated SDK fail to compile.

    A path param named after one of the method's own arguments or locals was declared twice: `/notes/{body}` on an operation with a request body gave `PutNoteAsync(string body, Note body, ...)`, error CS0100. A path param now gets a trailing underscore when it lands on `body`, `query`, `customHeaders`, `pathParams`, `cancellationToken`, the `response` and `headers` locals, or the client's `http` field, so that method takes `string body_`. Keyword escaping is unchanged (`string @class`). The pattern variable an optional response header is read into is renamed the same way, so a header named like a parameter no longer redeclares it (CS0136).

    An operation that declares both a request `headers:` block and response headers generated two records named `<Method>Headers` in one namespace, error CS0101. The request record keeps that name, since it is the one a caller constructs, and the response record becomes `<Method>ResponseHeaders`. Operations declaring only one of the two are unchanged.

## 0.1.3

### Patch Changes

- ad6b72e: A default on a field whose property shares its enum's name now compiles. `rating?: Rating = neutral`
  generated `public Rating? Rating { get; init; } = Rating.Neutral;`, and inside the record `Rating`
  resolved to the property rather than the type, so the build failed with CS0236. C#'s rule that lets a
  member share its type's name only applies when the member's type is exactly that type, and `Rating?`
  is `Nullable<Rating>`. The initializer is now written from the global namespace whenever a property of
  the same record would shadow the enum.

## 0.1.2

### Patch Changes

- b0f3778: Published builds no longer wrap every function in a `__name()` call, so a bundler can drop the
  exports it does not use. The shared tsconfig enabled `emitDecoratorMetadata`, which made tsup compile
  through swc with `keepNames` forced on, and nothing in the repo uses decorators. `@contractkit/core`
  shrinks by about 7%, and anything that bundles it, the VS Code extension included, no longer
  carries core functions it never calls.
- Updated dependencies [b0f3778]
    - @contractkit/core@0.30.1

## 0.1.1

### Patch Changes

- Updated dependencies [17f4261]
    - @contractkit/core@0.30.0

## 0.1.0

### Minor Changes

- 024df73: Add `@contractkit/plugin-csharp`, a C#/.NET SDK generator built on `System.Text.Json` and `HttpClient` with no NuGet dependencies, so a generated SDK restores and builds with no feed reachable.

    It emits one file of `sealed record` models per contract file and one client of `Task`-returning `...Async` methods per operation file, alongside a small runtime (`SdkHttp`, `SdkException`, `SdkOptions`, the wire converters) and an aggregator sharing one `HttpClient` across every client. `scaffold: true` writes `<SdkName>.csproj` once, as a user-owned file.

    Where it differs from the Kotlin generator it mirrors: an optional field and a required-nullable field are told apart per property (`T?` with `[JsonIgnore(WhenWritingNull)]` versus `required T?`), so a null the contract requires is written and an absent field is omitted; every tuple is hoisted with a type-level converter, so one nested in a collection still travels as a JSON array; a discriminated union is a marker interface its member records implement, so one contract can belong to several unions; and the generated output is compiled by `dotnet build` in the cross-plugin test suite wherever a .NET SDK is installed.
