---
'@contractkit/plugin-csharp': patch
---

A default on a field whose property shares its enum's name now compiles. `rating?: Rating = neutral`
generated `public Rating? Rating { get; init; } = Rating.Neutral;`, and inside the record `Rating`
resolved to the property rather than the type, so the build failed with CS0236. C#'s rule that lets a
member share its type's name only applies when the member's type is exactly that type, and `Rating?`
is `Nullable<Rating>`. The initializer is now written from the global namespace whenever a property of
the same record would shadow the enum.
