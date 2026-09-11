---
'@contractkit/plugin-python': minor
---

Keep model field names clear of Pydantic's `BaseModel` attributes, and of the type names their own class annotates with.

**`BaseModel` attributes.** A field named `model_config`, or anything in the `model_dump` and `model_validate` families, failed class creation, so the module did not import. A field named after any other `BaseModel` attribute (`json`, `copy`, `schema`, `validate`, `model_copy`...) imported with a `UserWarning` and replaced the method, which breaks under `-W error` and breaks any caller of that method. All of these now get a trailing underscore and an alias: `json_: str = Field(alias="json")`. A model with a `model_` field that collides with nothing (`model_name`) keeps the name and gets `protected_namespaces=()`, since Pydantic before 2.10 warned on any `model_` prefix.

**Type names.** Pydantic evaluates a model's annotations against the class namespace, so a field that puts a value there under a type's name replaced that type for the whole class. `date: date | None = None` failed to import, and `date: str | None = None` next to `when: date` imported fine and then validated `when` as `None`. Such a field is now `date_` with an alias. A field with no default (`date: date`) puts nothing in the namespace, already works, and keeps its name.

A model and its `Input` variant always agree on a field's name. Every escaped field still goes on the wire under its contract name.

**Minor rather than patch, because some attributes are renamed.** A field named after a `BaseModel` method that only warned (`json`, `copy`, `schema`, `validate` and the like) used to be reachable as `seat.json`, and is now `seat.json_`. Every other rename here is of a field whose module could not be imported.

The client now reads a path param off a `params` model by contract name, `params.model_dump(by_alias=True)['paymentId']`, rather than as an attribute. The attribute name now depends on the model's other fields, which the client generator never sees.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
