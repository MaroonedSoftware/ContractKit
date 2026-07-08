---
'contractkit-vscode-extension': patch
---

Fix hover, go-to-definition, and find-references returning nothing when the cursor sits at the end of a line on the last token (e.g. right after `datetime` in `createdAt: readonly datetime`).
