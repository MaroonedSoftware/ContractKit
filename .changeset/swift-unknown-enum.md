---
'@contractkit/plugin-swift': minor
---

Decode an enum value the SDK does not know instead of throwing, so a service that adds an enum member no longer breaks an older client. Every generated enum gains an `unknown` case and writes its own `init(from:)` and `encode(to:)`: a known wire spelling decodes and encodes exactly as before and an unrecognised string decodes to `.unknown`, in optional properties, arrays and request parameters alike. Encoding `.unknown` throws an `EncodingError`, since it has no wire spelling. In a plain union, an enum member claims only a string it knows, so a later `String` member still receives one it does not, and a string no member claims falls back to the first enum member's `.unknown`. A contract with its own `unknown` value keeps `unknown` for it and the extra case becomes `unknown2`.

Because `.unknown` has no spelling, the enum is no longer `String`-backed. It declares `public var rawValue: String?` (`nil` for `.unknown`), `public init?(rawValue: String)` (`nil` for a spelling it does not know) and an explicit `allCases` listing only the declared members, and it now conforms to `Hashable` directly. Code that used `rawValue` as a non-optional `String` needs to unwrap it.
