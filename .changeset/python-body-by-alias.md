---
'@contractkit/plugin-python': patch
---

Send model request bodies under their contract field names, and leave out optionals the caller never set.

Model bodies were serialized with `body.model_dump(mode="json")`, which uses Python names. Every renamed field went out as `unit_price` instead of `unitPrice` or `refresh_token` instead of `refreshToken`, and a ContractKit server's `z.strictObject` rejects both the unknown key and the missing one. Every absent optional also went out as `null`, which a field declared `.optional()` rejects too.

The generated call is now `body.model_dump(mode="json", by_alias=True, exclude_unset=True)`, for JSON and urlencoded bodies alike.

`exclude_unset` rather than `exclude_none`, because a required nullable field (`billTo: Address | null`) must be able to send an explicit `null`. The constructor forces the caller to set such a field, so it always survives `exclude_unset`, while `exclude_none` would drop it and the server would report the key missing. A field with a contract default that the caller leaves alone is omitted too, and the server applies the same default. Fields set by attribute assignment or `model_copy(update=...)` count as set.

One case this does not cover: passing `None` explicitly to an optional field that is not nullable (`tracking_code=None`) still sends `null`. Leave the argument out instead.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
