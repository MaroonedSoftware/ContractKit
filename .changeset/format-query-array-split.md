---
'@contractkit/plugin-typescript': patch
---

A router now splits a comma-joined query array of a `format()` model, as it already did for an inline query array and for a plain model's.

A query string carries a one-element list as `tag_ids=only`, which the framework parses to the string `"only"`. A `query:` block re-wraps each array field of its model in a `z.preprocess` that splits such a string, read back off the model's `.shape`. A `format()` model's schema is a pipe with no `.shape`, so its arrays were left as they were, and `tag_ids=only` or `tag_ids=a,b` was rejected. They are now read off the pipe's object, under the key that object parses, and the result is piped back through the model's own transform:

```ts
SnakeFilter.in.extend({
    tag_ids: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, SnakeFilter.in.shape.tag_ids),
}).strict().pipe(SnakeFilter.out)
```

The same goes for a `format()` member of a query intersection, whose arrays are re-wrapped before the block's mode and the transform. An inline member that redeclares the object's key (`tag_ids`) takes the field over, as `.extend()` does.
