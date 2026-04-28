---
'@maroonedsoftware/contractkit-plugin-typescript': minor
'@maroonedsoftware/contractkit-plugin-markdown': minor
'@maroonedsoftware/contractkit-plugin-openapi': minor
'@maroonedsoftware/contractkit-plugin-python': minor
'@maroonedsoftware/contractkit-plugin-bruno': minor
'@maroonedsoftware/openapi-to-ck': minor
'contractkit-vscode-extension': minor
'@maroonedsoftware/prettier-plugin-contractkit': minor
'@maroonedsoftware/contractkit': minor
'@maroonedsoftware/contractkit-cli': minor
---

Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.
