---
'@contractkit/plugin-kotlin': minor
---

Add `@contractkit/plugin-kotlin`, a Kotlin Multiplatform SDK generator built on Ktor and kotlinx.serialization.

It emits one `@Serializable` models file per contract file and one client of `suspend fun` methods per operation file, into a `commonMain` source set, alongside a small Ktor runtime and an aggregator that shares a single `HttpClient` across every client.

Two places the language and Kotlin disagree, and how the generator resolves them:

- **Inheritance.** A Kotlin `data class` cannot extend another, so a contract's bases are flattened into the generated class through core's `resolveEffectiveFields`, applying the same later-wins override rule the inheritance validator enforces.
- **Unions.** Neither union form has an anonymous Kotlin equivalent, so each becomes a named `sealed interface` with a generated serializer. A plain union wraps each member in a case and decodes by trying members in declaration order, matching `z.union` on the server. A discriminated union is implemented by the member classes directly and dispatches on the tag, which stays a real defaulted property rather than a kotlinx class discriminator — so a member still carries its tag when posted on its own, and one contract can belong to several unions.

Enums, inline objects, intersections and odd-arity tuples used inside a field are hoisted into named declarations, uniquely across the whole project. Response headers are converted to their declared types; an operation declaring several statuses or content types returns a flat sealed interface, so a caller's `when` stays exhaustive. Which statuses come back as a value and which raise `SdkError` follows the same `response-sets` rule the router and the other SDKs use.

`scaffold: true` writes `build.gradle.kts`, `settings.gradle.kts` and `gradle.properties` once, as user-owned files.

The generator is unit- and snapshot-tested, but the Kotlin it emits has not yet been compiled against a real toolchain. See the package README for that and the other known limitations.
