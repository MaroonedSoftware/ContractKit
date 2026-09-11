---
'@contractkit/plugin-python': patch
---

A field, parameter or method whose name is a Python keyword no longer breaks the generated module.
`class: string` emitted `class: str` in the model body and `sdk: import` emitted `async def import(...)`,
and either one is a syntax error that stops the whole package from importing. Such names now take a
trailing underscore, the PEP 8 convention (`class_`, `import_`), and a renamed field is aliased to its
wire name like any other rename, so `"class"` still reaches the server.
