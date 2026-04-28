---
'@maroonedsoftware/contractkit-plugin-typescript': minor
'@maroonedsoftware/contractkit-plugin-python': minor
'contractkit-vscode-extension': minor
'@maroonedsoftware/prettier-plugin-contractkit': minor
'@maroonedsoftware/contractkit': minor
---

Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.
