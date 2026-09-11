---
'@contractkit/plugin-docs': patch
---

The `openapi` target quotes a string that a YAML parser would otherwise read as a number.

Only a leading digit triggered quoting, so a string such as `-9007199254740993`, `-0.10` or `.5` was written bare, and every YAML reader resolved it as a number. A negative `bigint` bound in `x-contractkit-min` came back rounded to a float, a negative `decimal` bound came back as a number instead of its source text, and a negative `bigint` default became a number on a `type: string` schema. These strings are now single-quoted.
