---
'@maroonedsoftware/contractkit-plugin-typescript': minor
'@maroonedsoftware/contractkit-plugin-openapi': minor
'@maroonedsoftware/prettier-plugin-contractkit': minor
'@maroonedsoftware/contractkit': minor
'@maroonedsoftware/contractkit-cli': minor
---

Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
