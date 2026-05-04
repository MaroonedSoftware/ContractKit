---
'@contractkit/prettier-plugin': patch
---

Fix prettier printer to re-quote enum values that contain spaces or other non-identifier characters, preventing round-trip parse failures for values like `"Sole Proprietorship"`.
