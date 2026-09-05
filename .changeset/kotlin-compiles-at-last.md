---
'@contractkit/plugin-kotlin': patch
---

Fix two bugs that stopped the generated Kotlin from compiling. Both were found the first time the output was put through a real Kotlin toolchain, which the package README said had never happened.

- **A comment OPENER in contract text swallowed the rest of the file.** `kdocLines` broke up `*/` but not `/*`, and Kotlin block comments nest: a `/*` inside a KDoc opens a second comment that the KDoc's own terminator then closes, leaving the outer one open. A contract describing a route as `/auth/factors/*` was enough to do it, and the compiler reported the damage at the next declaration rather than anywhere near the text that caused it.
- **A default against a NAMED enum contract was emitted as its wire spelling.** `contract Rating: enum(liked, neutral, disliked)` with `rating?: Rating = "neutral"` reaches the default renderer as a ref rather than as the enum node, so it fell through to the string branch and produced `val rating: Rating? = "neutral"` — a field typed as the enum class, initialized with a String. Refs to enum contracts now render the member, and a default naming no member leaves the field required rather than emitting an initializer that will not compile.
