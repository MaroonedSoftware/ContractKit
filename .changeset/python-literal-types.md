---
'@contractkit/plugin-python': patch
---

Render literal types as `Literal[...]`, so models with a literal field, and the discriminated unions built from them, can be used.

`literal("card")` rendered as a bare `"card"`, which as an annotation is a forward reference to a type named `card`. The module imported, and then the first attempt to build or validate the model failed with "`Card` is not fully defined". Every discriminated union member declares its discriminator this way, so no discriminated union worked in the Python SDK. Numeric literals rendered as a bare number, which is not a type either, and `literal(true)` as `true`, which is not Python.

They are now `Literal["card"]`, `Literal[42]` and `Literal[True]`, with the `Literal` import added wherever one appears.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
