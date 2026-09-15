---
'@contractkit/plugin-typescript': patch
---

The generated TypeScript SDK no longer changes decimal.js's global settings when it is imported.

SDK type and client files called `Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 })` at load time. That reconfigured the one decimal.js the SDK shares with the consumer's app, so importing a client changed how every `Decimal` in that app printed. The SDK now builds the decimals it revives (and parses, in zod mode) with a private `Decimal.clone({ defaults: true, toExpNeg: -9e15, toExpPos: 9e15 })`. Revived values still print in plain digits, and the app's own `Decimal` keeps whatever settings the app gave it. Request values were already written with `toFixed()`, so nothing the SDK sends depends on the global. Because the clone starts from decimal.js's defaults, arithmetic on a revived value runs at the default precision whatever the app has set with `Decimal.set`.

An SDK types file that holds only date or duration fields no longer imports decimal.js at all. It used to import it just to make that call.

Server output is unchanged: routers, MCP servers and server types still call `Decimal.set`, which is what keeps the `JSON.stringify` over a handler's own `Decimal` values out of exponential notation.
