---
title: "Token"
sidebar_position: 7
mdx:
    format: "md"
---

> Decodes snake_case keys and encodes PascalCase ones

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `accessToken` | `string` | Yes |  |
| `expiresIn` | `number` | No | *default: `3600`* |
| `refreshAfter` | `bigint` | No | *default: `9007199254740993`*. *sent as a digit string, "123" or "123n"* |

</details>
