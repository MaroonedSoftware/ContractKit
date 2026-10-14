---
'@contractkit/plugin-csharp': minor
---

Read an enum value the SDK does not know instead of throwing, so a service that adds an enum member no longer breaks an older client. Every generated enum gains an `Unknown = 0` member and a converter of its own, `<Enum>Converter`, replacing `JsonStringEnumConverter<T>`: a known wire spelling reads and writes exactly as before, an unrecognised string reads as `Unknown`, and a non-string token is still rejected. It applies to nullable properties, lists, dictionary keys and query, path, header and form values alike. Writing `Unknown` throws a `JsonException`, since it has no wire spelling. In a plain union, an enum member claims only a string it knows, so a later `string` member still receives one it does not, and a string no member claims falls back to the first enum member's `Unknown`.

`Unknown` is the first member, so `default(T)` is now `Unknown` and the numeric value of every existing member goes up by one; wire spellings and member names are unchanged. A contract with its own `unknown` value keeps `Unknown` for it and the sentinel becomes `Unknown2`.
