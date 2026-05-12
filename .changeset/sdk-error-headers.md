---
'@contractkit/plugin-typescript': minor
---

Expose response headers on `SdkError`. The generated error now carries `headers: Headers` (the raw `Headers` instance from the failed response) alongside `status`, `statusText`, and `body`, so catchers can read things like `X-Request-ID`, `Retry-After`, or `WWW-Authenticate` for logging, retry logic, and rate-limit handling.
