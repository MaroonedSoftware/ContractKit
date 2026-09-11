---
'@contractkit/plugin-python': patch
---

Treat a contract declared as a type, such as a discriminated union or an alias of a scalar, as a type rather than a Pydantic class.

A contract like `contract Instrument: discriminated(by=kind, Card | Bank)` or `contract Amount: decimal` generates a Python type alias (`Instrument = Annotated[Card | Bank, Field(discriminator="kind")]`, `Amount = Decimal`), but the client treated every capitalized reference as a class. An operation returning one generated `Instrument.model_validate(result)`, which raised `AttributeError: 'types.UnionType' object has no attribute 'model_validate'` on every response, and a request body of one called `.model_dump()` on a value that has none.

The client now knows which contracts are aliases. A response typed as one (or as a list, record or union reaching one) is validated through a module-level `TypeAdapter`, so the discriminator picks the right class, and a request body of one is serialized through the body `TypeAdapter`. Module-level adapters are now annotated (`_X: TypeAdapter[Instrument] = TypeAdapter(Instrument)`), which `mypy --strict` needs for an `Annotated` alias.
