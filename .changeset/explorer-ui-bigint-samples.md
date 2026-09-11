---
'@contractkit/explorer-ui': patch
---

Sample a `bigint` as a digit string. The curl request sample, the response example and the Try-It pre-fill rendered one as a JSON number, which the server's schema rejects and which disagrees with the OpenAPI output, where a `bigint` is now `type: string`. The value is now quoted, as a `decimal`'s already is.
