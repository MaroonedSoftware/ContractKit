---
'@contractkit/plugin-docs': patch
---

Keep an operation's `name:` as written in its page title. The name was lowercased word by word, so `name: OpenAI speech` became "Open ai speech"; it now stays "OpenAI speech", with only its first letter raised. A bare camelCase name such as `listActiveUsers` is still split into "List active users", and an acronym inside one (`getOpenAIKey`, or a camelCase area) now stays one word: "Get open AI key".
