---
'@contractkit/openapi-to-ck': patch
---

Only wrap a circular reference in `lazy()` where it breaks a real cycle

`lazy()` exists so that a reference between two contracts that depend on each other can be
deferred: `topoSortModels` emits dependencies before dependents and can only fall back to source
order for a cycle. A reference from an operation — a response body, request body, parameter, or
response header — names a model the generated module has already imported and fully evaluated,
so there is no cycle to break.

Every reference to a self-referential schema used to be wrapped, so importing a spec with a tree-
shaped model produced `application/json: lazy(Widget)` on every body mentioning it. References
inside a contract, including one extracted from an inline body schema, still wrap as before.

Also fixed: a model extracted from an inline request or response body schema was referenced by
the generated operation and never emitted, because the extracted-model list was read before path
conversion filled it. Any spec with an inline (non-`$ref`) body schema produced a contract
pointing at something that did not exist. The post-conversion self-check now runs reference
validation as well as parsing, which is what caught it — a reference to an undefined contract is
perfectly good syntax, so parsing alone could not.
