# @contractkit/contractkit-plugin-typescript

## 0.37.0

### Minor Changes

- 11b5e54: Rebuild Fastify router generation on `@maroonedsoftware/fastify`'s native-Fastify API (0.3+), which replaced its Koa-shaped `ServerKitRouter` with ordinary Fastify plugins.

    A generated router is now a `FastifyPluginAsync` rather than a `ServerKitRouter()` value, and each handler declares its body allow-list through `config.body` instead of a `bodyParserMiddleware(...)` call:

    ```ts
    export const BillingRoutes: FastifyPluginAsync = async app => {
        app.post('/payments', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
            const body = await parseAndValidate(request.body, PaymentInput);

            const service = request.container.get(PaymentService);
            const result: Payment = await service.create(body);

            reply.status(200);
            reply.type('application/json');
            return reply.send(result);
        });
    };
    ```

    What changed from the previous adapter:
    - **Routes are plugins, not router methods.** Register the generated file with `builder.setupRoutes([BillingRoutes])` (or `{ plugin: BillingRoutes, prefix: '/api' }`), the same as any other Fastify route plugin. `ServerKitRouter` and `bodyParserMiddleware` are gone from `@maroonedsoftware/fastify`'s public surface, so generated code no longer imports either.
    - **The parsed body is Fastify's own `request.body`.** `request.parsedBody` no longer exists; `bodyParserPlugin` now replaces Fastify's content-type parsers outright rather than adding a side channel.
    - **A route's body allow-list is declarative.** `config.body` lists the literal content types the operation declares (`['application/json']`), not a parser token — Fastify gates on the raw `Content-Type` itself.
    - **Guards live in `preHandler`.** `requirePolicy()` and `requireSignature(...)` are unchanged calls, now collected into a `preHandler` array on the route options rather than passed positionally before the handler.
    - **Content-type dispatch no longer calls a runtime helper.** `requestMediaType` isn't part of the package's public surface any more; a multi-MIME operation's `switch` strips the header inline instead.
    - **The generated router constant is named `...Routes`,** matching the plugin idiom, instead of `...Router`.

    The generated `mcp.router.ts` follows the same shape: `mountMcp` is now a `FastifyPluginAsync` registered with `builder.setupRoutes([mountMcp])`, instead of a function taking a router instance.

    `koa` remains the default and its output is unchanged.

## 0.36.0

### Minor Changes

- 18263e2: Generate Fastify routers with `server.framework: "fastify"`.

    ```json
    "server": { "framework": "fastify", "baseDir": "apps/api/" }
    ```

    Output targets `@maroonedsoftware/fastify`, whose exported surface mirrors the Koa one, so a contract compiles to the same handlers either way:

    ```ts
    BillingRouter.post('/payments', requirePolicy(), bodyParserMiddleware(['json']), async (request, reply) => {
        const body = await parseAndValidate(request.parsedBody, PaymentInput);

        const service = request.container.get(PaymentService);
        const result: Payment = await service.create(body);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });
    ```

    Three differences are worth knowing before you switch:
    - **The request is the context.** Handlers take `(request, reply)`, and params, query, headers, the DI container and the parsed body all hang off `request`. Fastify's own `request.body` is never populated, because ServerKit parses lazily per route.
    - **Responses are returned, not assigned.** A handler that neither returns a body nor calls `send` leaves the request hanging, so a bodyless 204 emits an explicit `return reply.send();` where Koa emits nothing at all.
    - **Content type comes from `requestMediaType(request)`.** Fastify has no accessor that strips the parameters off the header, and a raw `application/json; charset=utf-8` matches none of the MIME literals an operation declares.

    `koa` remains the default and its output is unchanged. The generated `mcp.router.ts` follows the setting, using `reply.hijack()` where the Koa mount sets `ctx.respond = false`.

    Separately, a path parameter whose name collides with an identifier the handler already binds is now renamed. `/threads/{reply}` emitted `const { reply } = ...` inside `async (request, reply) => {`, a redeclaration under `tsc` and a temporal-dead-zone `ReferenceError` at runtime; the same held on Koa for a parameter named `ctx`, and on both for one named after a generator local such as `body` or `query`. Only the local binding moves, so the wire name, the schema key and the route placeholder are untouched.

## 0.35.0

### Minor Changes

- 731ab7a: Add `server.framework`, and render the generated router through a framework adapter.

    The server sub-generator emitted the Koa flavour of ServerKit inline: `ServerKitRouter()`, `async ctx => {`, `ctx.params`, `ctx.parsedBody`, `ctx.container.get`, `ctx.status`, `ctx.set`, `ctx.type`, `ctx.body`, and a wholly Koa-specific `mcp.router.ts`. Every one of those strings now comes from a `ServerFramework` adapter, and `server.framework` selects it:

    ```json
    "server": { "framework": "koa", "baseDir": "apps/api/" }
    ```

    `koa` is the only supported value and the default, so **generated output is unchanged, byte for byte** — the option exists so a later release can target another framework without touching the generator. A name with no adapter fails config validation rather than emitting code that cannot run:

    ```
    plugin-typescript: server.framework 'express' is not supported — expected one of: koa.
    ```

    The optional `mcp.router.ts` follows the same setting, including when there is no `server` sub-config at all, where it stays Koa.

    Two internal changes came with it. `generateParamValidation` decided whether it was rendering query params or path params by comparing its accessor argument against the literals `'ctx.query'` and `'ctx.params'`, so the query-string array coercion and the destructuring of path params both hung on the exact spelling of a Koa accessor; it now takes the kind explicitly. And the response seam is shaped for a framework that ends a response by returning rather than by assigning: the adapter supplies the terminal statement for bodyless responses too, and supplies whatever closes a status case, since a `return` followed by a `break` is unreachable code.

## 0.34.1

### Patch Changes

- 3e90488: Stop the MCP aggregator from calling `container.register`, and underscore the unused `args` parameter on no-argument tools.

    `generateMcpAggregator` emitted `container.register(McpToolHandlerMap, { useValue: map })`. InjectKit's `Container` has no `register`; it exposes only `get`, `createScopedContainer`, `hasRegistration`, `disposeAsync`, and `[Symbol.asyncDispose]`. Registration belongs to `Registry`, the composition-phase object, while `Container` is the resolution-phase one. Every generated `mcp.tools.ts` therefore failed to compile with `TS2339`, and would have thrown at startup if it had.

    `registerMcpTools` now only builds the map and returns it. Its doc comment shows the binding that supplies the `Container` in the first place:

    ```ts
    registry.register(McpToolHandlerMap).useFactory(registerMcpTools).asSingleton();
    ```

    `generateMcpRouter`'s doc line told consumers to _call_ the aggregator at startup, which is the same mistake. It now points at the binding.

    Separately, `renderToolClass` always named the handler's first parameter `args`. An operation with no path parameters and no request body destructures nothing, so the parameter went unread and tripped `@typescript-eslint/no-unused-vars` in consumers that lint generated output. It is now emitted as `_args` when there is nothing to destructure.

## 0.34.0

### Minor Changes

- f453bf5: Honour the optionality an inline `query:` or `headers:` block declares, in the router, the SDK and the OpenAPI document.

    All three read the same `OpParamNode.optional`, and all three ignored it. The router validated every inline param as required, the SDK typed every one optional, and OpenAPI marked every non-path parameter `required: false`. So for a contract saying

    ```
    query: { limit?: int = 20, cursor: string }
    headers: { api-key?: string, x-tenant: string }
    ```

    the SDK let you omit a `cursor` the router would then reject, while typing `limit` as something you had to think about even though it has a default; and the published spec disagreed with both.

    Now:
    - **Router** — the param schema carries the same modifier chain a model field does, via the shared `applyFieldModifiers`. `limit` becomes `.default(20)`, `api-key` becomes `.optional()`. The hand-rolled query-array preprocess is gone too, delegating to `renderQueryType`, which already had that rule.
    - **SDK** — a field is optional only when the contract says so, either with `?` or by carrying a default. The whole argument is optional only when every field is, since a caller cannot omit an object that must supply something.
    - **OpenAPI** — `required` follows the contract for query and header parameters, matching what the `inlineObject` branch already did. The two `$ref` branches are unchanged: a whole-model param source has no per-field optionality to read.

    **Python is deliberately excluded.** It hardcodes `optional: true` on query and headers, and has the same ordering constraint as a `SyntaxError` rather than a type error. Permissive is safe; changing it belongs with the work that gives inline query params a `TypedDict`.

    ### What this breaks

    **SDK call sites stop compiling when an argument becomes required.** The old signature was wrong in both directions at once, so this surfaces two different latent bugs: calls that omitted a value the router demanded, and required fields typed as optional so nothing made you pass them.

    **Requests omitting a non-optional inline param now get a 400.** They were already being rejected by the router; what changes is that the SDK and the spec now say so. To find the affected surface, grep your contracts for inline `query:` and `headers:` blocks whose fields lack a `?` — that set is exactly the delta.

    One case only becomes reachable now: parameter order is path, body, query, then customHeaders, so an all-optional `query:` in front of an all-required `headers:` would emit `async m(query?: Q, customHeaders: H)`, which is `TS1016`. A normalisation pass clears `optional` on every argument before the last required one, which is the only fix that keeps the positional order call sites depend on.

- c93b5c4: Return 204 when an operation emits no response, instead of an error status.

    The generated router picked its status as `emitted ?? first declared ?? 200`. For an operation whose response block is documentation only, the first declared status is an error code, so the router answered a _successful_ request with it:

    ```
    delete: {
        response: {
            400:
        }
    }
    ```

    emitted `ctx.status = 400` on the success path. A bare status means "documented, produced by something else" — middleware, a proxy, the framework — so it is precisely the status the service does not produce, and the worst possible choice of fallback.

    204 is the status that aligns the three generators. `observableResponses` excludes a bare `400:` for the same reason `emittedResponses` does, so the SDK already types such a method `Promise<void>` and `thrownResponses` already puts the 400 in `@throws`. A bodyless 204 success is exactly what `Promise<void>` means; the router was the only one disagreeing.

    ### What this breaks

    **Operations declaring only non-2xx statuses now return 204 rather than that status.** The old behaviour was an error code returned on success, so any client treating it as an error was correct to and now gets a success it can act on. If you genuinely want that status written, give it a block — `400: { … }` — which makes it service-produced and restores it.

    An operation with no `response:` block at all also moves from 200 to 204, on the same reasoning: it emits nothing, and 204 says so precisely. Both are 2xx, so nothing that checks for success changes behaviour; a client asserting `status === 200` would need updating.

- 0e10409: Apply the bigint JSON reviver only to contracts that actually declare a `bigint`.

    `parseJson` ran every response through `bigIntReviver`, which tests `/^-?\d+n$/` against every string anywhere in the document. A contract with no `bigint` field still had a legitimate value like `"123n"` — a product code, a hash fragment, a user's own text — silently turned into a `BigInt`, at any depth, in any field.

    The shared runtime now exports two functions. Clients whose responses carry a `bigint` import `parseJsonWithBigInt` aliased to `parseJson`, so the method bodies are identical either way and the import line is where the choice is legible.

    The predicate is transitive and cross-file, because a `bigint` reached through a referenced model still arrives on the wire as `123n`. It comes from a `modelsWithBigInt` taint set computed the same way `modelsWithDecimal` is, and sliced into the same per-file fingerprints — so a model gaining a `bigint` in another `.ck` file invalidates the clients that read it, rather than leaving a cached client with the wrong import.

    A full schema-driven revival was considered and rejected: `bigIntReplacer` serialises bigints at any depth on the way out, so a path-aware reviver would have to cover exactly the same paths to stay symmetric. Gating the whole reviver on a contract-level predicate takes almost all of the benefit for a fraction of the machinery.

    Renamed `sdkNeedsBigIntReviver` to `sdkParsesJsonResponse` along the way. It tests whether an operation reads a JSON response body at all, which is now the gate for importing `parseJson` in either form — and is a different question from whether the reviver is needed.

    ### What this breaks

    A response field holding the string `"123n"` now stays a string, unless the contract declares that field as `bigint`. If you were relying on the conversion, declare the field `bigint` and it comes back.

- a3c2598: Reject non-string JSON values for numeric scalars, instead of silently turning them into numbers.

    `number` and `int` compiled to `z.coerce.number()`, which is `Number(v)`. That accepts far more than a number: `[]` and `""` become `0`, `null` becomes `0`, `true` becomes `1`. So `{"quantity": []}` validated cleanly and the handler ran on a value the client never sent.

    The coercion is now narrowed to the case that motivates it:

    ```ts
    z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number());
    ```

    A non-empty string still converts, because query strings and headers arrive as text and a JSON body carrying `"42"` is common enough that rejecting it would break working callers. Everything else is handed to `z.number()`, which judges it.

    This is the shape the `boolean` scalar already had: its preprocess maps only the two literal strings and passes everything else through to `z.boolean()`. It needed no change.

    Constraints move inside the preprocess — `z.preprocess(…, z.number().min(1))` rather than `.min(1)` on the outside — because `z.preprocess` returns a `ZodPipe`, which has no `.min()`. The `bigint` scalar already did it this way.

    ### What this breaks

    `{"petId": []}`, `{"n": null}` and `{"n": true}` now get a 400 where they previously validated as `0`, `0` and `1`. Frame this as the fix it is: those requests were being accepted and acted on with a value the caller did not send. String-shaped numbers still coerce, so query parameters and headers are unaffected.

    Not addressed here: the JSON-versus-string wire split. `XInput` is a single exported `const` reused for both `query: X` and `request: { application/json: X }`, so a truly strict body schema needs a second emitted variant plus import plumbing. `renderInputScalar` remains the documented seam for that, with its docstring corrected — it claimed to coerce from string input while being a pure passthrough.

- cb06aec: Derive valid identifiers from path parameter names, so a hyphenated path param generates code that works.

    `operation /invoices/{invoice-id}` is a legal contract — the grammar's `identPart` admits `-` and `.` — but it is not a valid TypeScript identifier, and every TypeScript generator used the contract's spelling directly:

    ```ts
    HyphenatedRouter.get('/invoices/{invoice-id}', requirePolicy(), async ctx => {
        const { invoice-id } = await parseAndValidate(ctx.params, ...);
    ```

    Three separate failures in those two lines. The route pattern kept the braces, so Koa registered a literal path no request could match. The destructuring did not parse. And the SDK emitted `async getInvoice(invoice-id: string)`, which did not parse either.

    Names the generated code has to _bind_ are now mapped through `toIdentifier`, so `invoice-id` becomes `invoiceId`:
    - **Router** — the Koa pattern becomes `/invoices/:invoiceId`, the params schema is keyed to match (that is what `ctx.params` carries), and the service call passes the bound name.
    - **SDK** — the method parameter and the URL interpolation use the identifier.
    - **MCP** — the tool's input schema and the handler's destructuring use it.

    **Nothing on the wire changes.** A path placeholder's name never reaches the client: Koa matches by position, so `GET /invoices/abc123` behaves exactly as before. That is what makes the rename safe, and it is the reason query parameters, headers and OpenAPI parameters are deliberately _not_ renamed — those names are what the client actually sends, or must match a path template the same document declares.

    `toIdentifier` returns its input unchanged whenever it is already an identifier, so no existing generated output moves. It lives in core next to the path-parameter pattern, because the Bruno plugin needs the same mapping for its own `:variable` syntax.

- 12040d1: Revive temporal scalars in generated SDK clients, so a `datetime` field really is a Luxon `DateTime`.

    In `sdk: { zod: true }` mode a `datetime` field's type comes from `z.infer` over `z.custom<DateTime>`, so the SDK has always _claimed_ to return a `DateTime`. The client reads its response with `JSON.parse` and a cast, and never runs the schema — so at runtime the field held a string, and `order.shipDate.toISO()` threw. The same held for `date`, `time` and `duration`.

    The generated `reviveX` functions now rehydrate those scalars alongside `decimal`, using helpers that mirror what the schema validates against:
    - `datetime` → `DateTime.fromISO`
    - `duration` → `Duration.fromISO`
    - `date` and `time` → `DateTime.fromFormat` with the format from the contract, defaulting to `yyyy-MM-dd` and `HH:mm:ss`

    Each throws a `TypeError` naming the field path rather than returning something invalid, since a silently wrong `DateTime` surfaces much further from its cause than a throw at the boundary does. A file gets only the helpers its revivers call, decided by scanning the emitted text — the idiom the reviver and type imports already use, for the same reason: a separately computed predicate can drift and leave an unused local behind.

    `interval` is deliberately excluded. `_ZodInterval` ends in `.transform(v => v.toISO()!)`, so its inferred output type is already `string` and there is nothing to revive it to. Covering it means making that round-trip idempotent first, which the router's `isRevalidatable` also depends on.

    Two things ride along:

    **Plain types now say `DateTime` too.** `renderTsScalar` mapped every temporal to `string` for both targets, so `types:` output disagreed with what the router and the SDK actually hand you. It now renders the Luxon classes, and the emitted file imports them.

    **`_ZodBinary` follows the render target.** It was `z.custom<Buffer>` unconditionally, and SDK type files reach it through the same `generateContract`, so a browser client got `Buffer.isBuffer` with no `@types/node` in its scaffold — the type did not resolve and the check could not run. The SDK's schemas are now client-shaped (`Blob`), matching what `renderTsScalar` has always said for that target; the server and standalone `zod:` outputs are unchanged.

    No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch. Cache invalidation for the wider taint set comes for free: every `hashFingerprint` that slices it already exists, so a model gaining a `datetime` in another `.ck` file invalidates dependent output as it should.

### Patch Changes

- 27af3f2: Generalise the decimal taint-set helpers over an arbitrary set of scalars.

    `typeHasDecimal` and `computeModelsWithDecimal` hardcoded `decimal`, but the question they answer is not specific to it: any scalar whose runtime type differs from what `JSON.parse` produces taints a model the same way, and needs the same transitive answer through referenced models.

    Core now exports `typeHasScalar(type, scalars)` and `computeModelsWithScalar(models, scalars, external)`. `computeModelsWithDecimal` stays as a thin wrapper over a one-member set, so every existing caller is untouched. The TypeScript plugin's `ReviveCodegenOptions` gains an optional `revivableScalars`, defaulting to the same one-member set.

    Decimal remains the only member and no generated output changes.

    One thing settled in passing: core's predicate checks a `record`'s key _and_ value while the reviver's checks only the value, and that divergence is correct rather than an oversight. Core answers "is this scalar mentioned", which decides imports, and a `record(decimal, string)` schema does reference the `Decimal` type. The reviver answers "is there a value to rehydrate", and a JSON object key is always a string, so there is nothing at a key position to convert. Both are now documented in place.

- fb39996: Fix `@deprecated` being dropped from generated SDK methods that also have a description.

    The SDK emitted the deprecation as its own block, immediately above the block carrying `@name`, `@description` and `@throws`:

    ```ts
    /** @deprecated */
    /** @description look up a refund by its originating payment */
    async getRefund(params: PaymentRef): Promise<Payment> {
    ```

    TypeScript associates only the JSDoc comment _adjacent_ to a declaration, so the deprecation was invisible to editors and to `tsc` whenever the operation also had a description or an error contract, which is the common case. It survived only on operations that had nothing else to document.

    `@deprecated` is now a tag inside the one block, in the same position the Koa router already puts it:

    ```ts
    /**
     * @description look up a refund by its originating payment
     * @deprecated
     */
    ```

    No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.

- 78462d7: Stop emitting the `ModelBase` Zod schema, which nothing has ever read.

    A model with writeonly fields emitted three schemas: `ModelBase` with every field, `Model` (read, no writeonly) and `ModelInput` (write, no readonly). Only the last two were exported. `ModelBase` was a plain `const`, and the sole place a `XBase` name was ever _referenced_ was inside the block that declares `YBase` for a child model — so `XBase` was read only by `YBase`, and no `YBase` was read by anything reachable. The read schema extends the parent's read schema directly, and the input schema extends the parent's input schema; neither goes through a Base. The construct was a closed island, and under `noUnusedLocals` it is a compile error in the generated file.

    Nothing is lost with it. Writeonly inheritance was the thing Base was meant to deliver, and it already rides on the Input chain: a child's `ModelInput` extends its parent's `ModelInput`, which carries the parent's writeonly fields. That is why removing Base changes no exported schema, no inferred type, and no runtime validation.

    This supersedes the narrower change of emitting `XBase` only when some writeonly model extends `X`. That predicate turns out to be unsatisfiable in practice: gating the child's Base on having a reader of its own removes the only reference to the parent's Base, so the correct set is always empty.

    Visible in diffs but not breaking: an unexported `const` disappears from generated schema files.

- 383d26f: Stop importing model types into SDK clients that never mention them.

    `collectTypes` walks the AST and reports every model a request body names, regardless of its content type. `buildMethodParams` types a `multipart/form-data` body as `FormData`, so that model is never mentioned in the emitted method and its import is left unused, which is a compile error under `noUnusedLocals`. The same happened to a model's read variant when only its `Input` variant was actually referenced.

    The collected list is now filtered against the emitted text before imports are generated: the method bodies, the error-body aliases and the inline reviver declarations. This is the idiom the reviver imports in the same function already use, and it errs toward keeping — a name appearing only inside a doc string counts as a reference, because a surplus import is untidy while a missing one does not compile.

    Multipart is deliberately not special-cased inside `collectTypes`. Validating multipart bodies against their declared contract is work still to come, and it would have to undo that special case; with a text-derived filter the model becomes referenced on its own the moment the body is checked, and the import comes back automatically.

    The aggregator path, which calls `collectTypes` separately when several op files merge into one area client, gets the same filter.

    Visible in diffs but not breaking: an `import type` shrinks or disappears. Nothing exported changes.

- b239519: Coerce SDK response headers to the types the return shape declares.

    `renderSdkHeadersShape` types the `headers` object from the contract, while `sdkHeaderEntries` assigned `result.headers.get(name) ?? undefined` regardless. That produced `TS2322` in both directions at once: a header declared `int` was typed `number` and given a `string | undefined`, and a _required_ header was typed `T` and given `T | undefined`. Neither compiled.

    The value expression now follows the resolved scalar, and this table is shared with the Python SDK:

    | Declared type                                                    | Expression                                                 |
    | ---------------------------------------------------------------- | ---------------------------------------------------------- |
    | `string`, `email`, `url`, `uuid`, the date/time types, `unknown` | the raw value, asserted or defaulted per optionality       |
    | `int`, `number`                                                  | `Number(...)`, guarded on `null` when optional             |
    | `boolean`                                                        | compared against `'true'`, guarded on `null` when optional |
    | `bigint`                                                         | `BigInt(...)`, guarded on `null` when optional             |
    | anything else                                                    | rejected at codegen                                        |

    Optionality drives the null handling: `Headers.get` returns `null` for an absent header, so an optional header maps that onto `undefined`, which is what its `?` in the shape means, while a required one is asserted because the contract says the service always sends it.

    A header declared as a `decimal`, a `json`, a `binary`, a model reference, an array or an object is now a build error naming the header and the operation, which the CLI reports scoped to this plugin. Header values arrive as strings and there is no meaningful reading of those types from one; emitting code that does not compile is worse than refusing.

    The Python SDK reuses this table, with one asymmetry worth stating: temporals _do_ need coercion there, because `renderPyType` maps them to `datetime`/`date`/`time` objects while `renderOutputTsType` maps them to `string`.

    No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.

- 2597e3e: Fix generated SDK methods failing to compile when a route declares its path params as a model.

    `buildUrlExpression` accepted a `ParamSource` and discarded it, always interpolating the placeholder by bare name. That is right for a `params { … }` block, whose fields `buildMethodParams` spreads across the signature — but for `params: PaymentRef` the signature has a single argument called `params`, so the emitted URL named something that does not exist:

    ```ts
    async getRefund(params: PaymentRef): Promise<Payment> {
        const result = await this.fetch(`/refunds/${encodeURIComponent(paymentId)}`, { method: 'GET' });
    ```

    `TS2304`, plus `TS6133` for the now-unread `params`. This is the same root cause as the Python `NameError`: the name in the path and the name in the signature come from different places and were never reconciled.

    The value is now read off the argument, as `params.paymentId`. A placeholder that is not a valid property accessor uses bracket notation, and the expression is wrapped in `String(...)` because a model's field may be typed something `encodeURIComponent` does not accept.

    The spread-param branch is deliberately unchanged, including for a placeholder that is not a valid identifier. There the expression has to name a signature parameter, and `buildMethodParams` uses the contract's spelling verbatim — so when that spelling is not an identifier the method is already unsalvageable, and emitting an expression that parses as arithmetic would be no improvement over leaving the placeholder alone.

    No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.

- 1c36107: Fix the source links in generated TypeScript, which were malformed and did not resolve.

    Every generated schema, router, SDK client and MCP tool carries a markdown link back to the `.ck` declaration it came from. Those links were written as `[User](file://./../contracts/user.ck#L5)`. The `file://` prefix opens a URL authority component, so the `.` that follows parses as the _host_ rather than as a path segment, and the link resolves to nothing in an editor or a rendered doc. The correct form for a path relative to the emitted file is simply `[User](../contracts/user.ck#L5)`, which is what is now emitted.

    The seven sites that built this link each recomputed `relative(dirname(outPath), sourceFile)` by hand and concatenated the pieces inline. They now share one `sourceLink(label, outPath, sourceFile, line?)` helper in `ts-render.ts`, alongside `quoteKey`, `escapeJsDocLines` and `headerNameToProperty`. The helper returns just the link, since some callers wrap it in a JSDoc block and one emits it in a `//` comment. A path that does not already begin with `.` gains a `./` prefix so it reads unambiguously as relative.

    `TYPESCRIPT_CODEGEN_VERSION` is bumped to `2`. `runIncrementalCodegen` honours a cached manifest whenever its recorded `codegenVersion` matches, so without the bump anyone with a warm `.contractkit/cache` would keep the old files after upgrading.

    Visible in diffs but not breaking: the doc links change form. Nothing imports or depends on their text.

- fe9ea0b: Coerce temporal response headers to Luxon objects, completing the header table.

    When response headers first learned to follow their declared types, temporals mapped to `string` and passed the raw value straight through. Reviving temporal scalars later changed `renderOutputTsType` to produce `DateTime` and `Duration` — so the header _shape_ said `DateTime` while the entry still assigned a raw string, and the client file had no `luxon` import at all. A `datetime` response header therefore produced a client that did not compile.

    Temporal headers now convert, using the same functions the body reviver does and taking `date` and `time` formats from the contract. This also makes the TypeScript and Python SDKs symmetric: Python has coerced these since its own header types landed.

    Two details:

    The `luxon` import is decided from the emitted method bodies, like every other import in these files, and is added by both client paths — `generateSdk` for a top-level client and `generateAreaClient` for an area one. Only the first had the reviver's import logic, so an area client needed it separately.

    Optional headers assert non-null inside the conversion. TypeScript does not carry the narrowing from `get(x) === null` across a _second_ `get(x)` call, so without the assertion the optional form is a `TS2345` even though the ternary has already excluded null. The `bigint` case had the same latent error and is fixed with it — it was invisible because no fixture declared an optional `bigint` header.

    Found by running the real CLI over the reference contracts rather than the test harness, which is what that acceptance pass exists for: the fixture had no temporal response header, so nothing in the suite covered the interaction. It does now.

- e06d2e7: Warn when an output path template variable has no value.

    `resolveTemplate` leaves an unknown `{key}` in place, and the result joins straight into the output path — so a config using `{area}` against a `.ck` file that declares no `options { keys { area: … } }` quietly wrote its files into a directory literally named `{area}`. `assertWithinBase` did not catch it: the path is inside the base directory, just wrong.

    The build now says so, naming both the variable and the file it affected, and pointing at the two ways to fix it.

    The file is still emitted. Throwing would be a worse trade here — the CLI catches a `generateTargets` throw and continues to the next plugin, so refusing over one misconfigured file would cost you that plugin's entire output. This adds visibility, not a new failure mode.

    The check sits at the plugin's single `emitFile` funnel rather than being threaded down through the five path-computing helpers and their nine call sites. Every output path passes through that one point whichever helper built it, so one check covers all of them, and it catches a case a per-helper callback would miss.

- Updated dependencies [27af3f2]
- Updated dependencies [227c224]
- Updated dependencies [135947f]
- Updated dependencies [cb06aec]
    - @contractkit/core@0.29.0

## 0.33.3

### Patch Changes

- 637e13b: Fix four defects in the emitted `mcp.router.ts` that left the generated MCP endpoint non-functional. It now emits `bodyParserMiddleware(['json'])` ahead of `requireSignature`, which is what populates the `ctx.rawBody` the signature HMAC is computed over; answers notifications with `else ctx.status = 202` instead of leaving `ctx.body` unset and 404ing the `notifications/initialized` that follows every handshake; wraps the body as `JSON.parse(String(ctx.rawBody))`, since `ctx.rawBody` is `BinaryLike` and `JSON.parse` takes a `string`; and hands the stateful transport `ctx.parsedBody` rather than `ctx.request.body`, which ServerKit never populates and which the new body parser's stream read would otherwise leave empty.

## 0.33.2

### Patch Changes

- Updated dependencies [74b8a28]
    - @contractkit/core@0.28.2

## 0.33.1

### Patch Changes

- ffb2ec6: Ship an `llms.txt` in every package, so an AI assistant reading the package out of `node_modules` gets its exact name, a config block with real key names, the full option table, the programmatic API, and the mistakes specific to it — without needing the repo checked out.

    Correct several documented snippets that could not work as written. The five plugin READMEs named packages that do not exist (`@contractkit/contractkit-plugin-*`, and `-python-sdk` for the Python plugin) in both their install commands and their `contractkit.config.json` keys. `@contractkit/core`'s README exported `Diagnostics` and `validateOperation`, which are really `DiagnosticCollector` and `validateOp`, and gave the wrong signatures for three validation passes. `@contractkit/cli`'s README documented the OpenAPI importer as `contractkit openapi-to-ck --input <spec>`; it is `contractkit import-openapi <spec>`, with the path positional. `@contractkit/plugin-openapi` described its output as OpenAPI 3.0, but it emits 3.1.

- Updated dependencies [ffb2ec6]
    - @contractkit/core@0.28.1

## 0.33.0

### Minor Changes

- e102a2c: Add a `decimal` scalar, for money and anything else that has to be exact

    `number` compiles to `z.coerce.number()` — an IEEE-754 double. Anything monetary has to be exact,
    so contracts either lied about their types or routed the value through `string` by hand. `decimal`
    gives the language a type for it:

    ```
    contract Payslip: {
        gross: decimal(min=0, scale=2)
        rate: decimal
    }
    ```

    A decimal travels as a **quoted JSON string** (`{"gross": "1250.00"}`) and becomes a decimal.js
    `Decimal` — the same class Prisma hands you for a `Decimal` column, so a value moves between the
    two with no conversion. Python gets `decimal.Decimal`; OpenAPI gets `type: string, format: decimal`.

    A raw JSON number is **rejected**, not coerced. By the time one reaches the schema it has already
    been through a double, which is precisely the loss the scalar exists to prevent, so accepting it
    would defeat the point silently.

    **`scale=` is a validation constraint — at most N decimal places — not a formatting directive.**
    It cannot be one: the router assigns `ctx.body` and Koa serializes it with a `JSON.stringify` we
    have no replacer for, so the wire form is whatever decimal.js normalizes to and `"1250.00"` reads
    back as `"1250"`. The two are the same number; format at the display edge if you need the trailing
    zeros. This is also what `scale` means in OpenAPI `pattern`, pydantic `condecimal(decimal_places=)`
    and Prisma `@db.Decimal(_, n)`, so every downstream mapping stays honest.

    Generated code sets `Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 })` so values never serialize in
    exponential notation — without it `0.00000001` ships as `"1e-8"` and any peer validating
    `^-?\d+(\.\d+)?$` rejects it. Note this is global decimal.js configuration and affects every
    `Decimal` in the consuming process.

    SDK clients rehydrate decimals through generated `reviveX` functions. The `bigint` approach does
    not transfer — it works only because bigint invented a tagged `"123n"` wire encoding, and tagging a
    decimal would corrupt the format for every non-ContractKit consumer. Re-parsing responses through
    the Zod schema is not available either: `XOutput` is a type alias with no runtime value, and models
    default to `z.strictObject`, so any field the server added would throw in every deployed client.
    The revivers mutate in place, which preserves unknown server-added keys.

    Two placements are rejected at parse time, both errors rather than warnings since no existing
    contract can be relying on them. A decimal inside an **undiscriminated union** cannot be rehydrated
    — the SDK has no way to tell which arm arrived, and a convert-if-string fallback would silently
    rewrite a genuine `string` field in a sibling arm. A decimal in a **response header** has no
    parsing step at all, so the annotation would simply be false at runtime.

    `min`/`max` are kept as exact decimal strings rather than coerced through `Number()`, and OpenAPI
    carries them in `x-contractkit-min`/`-max` extensions, since JSON Schema's numeric `minimum` and
    `maximum` are ignored on a string type. A contract round-trips through OpenAPI and back with its
    bounds intact.

    SDKs that scaffold a `package.json` gain `decimal.js` as a dependency when a covered model uses the
    scalar. Existing scaffolds are write-once and are not updated, so add it by hand there.

### Patch Changes

- e102a2c: Fix scalar lists that had drifted out of sync with the language

    Four places kept a hand-written copy of the language's scalar names, and three had already fallen
    behind without anything failing to build:
    - The VS Code completion list and hover map were both missing `interval`, so the editor silently
      stopped recognising it — no completion, no hover.
    - The constraint-argument regex that decides when to offer `min=`/`max=` completions was missing
      `time`, `interval`, and every non-constrainable scalar.
    - `docs/language.md`'s scalar table was missing `duration`.

    The completion and semantic-token providers now read `SCALAR_NAMES` from `@contractkit/core`
    directly, which removes the drift class rather than patching this instance of it, and the
    constraint regex is built from those lists. What genuinely cannot derive from the set — a TextMate
    alternation, a per-scalar documentation map, a Markdown table — is now covered by a test that fails
    when any of them falls behind.

    Also fixes the SDK scaffold's luxon detection, which omitted `duration`. `generateContract` imports
    `Duration` from luxon whenever that scalar is present, so a contract whose only temporal type was a
    duration scaffolded a `package.json` with no `luxon` dependency and did not compile.

- Updated dependencies [e102a2c]
    - @contractkit/core@0.28.0

## 0.32.0

### Minor Changes

- 5dc2693: Add `server.validateResponses` — the generated Koa router can now validate what it sends, not just
  what it receives

    Handlers have always run request params, query, headers and body through `parseAndValidate`. The
    service's return value got nothing: it was type-annotated and assigned straight to `ctx.body`, so a
    service returning a shape its own contract forbids shipped it to the client unchanged. With
    `server.validateResponses: true` the result is re-parsed against the declared response schema and
    the _parsed_ value is written:

    ```ts
    const result: User = await service.getById(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = await parseAndValidate(result, User, 500);
    ```

    Because the parsed value is what reaches the wire, `mode(strip)` now actually strips extra keys off
    responses.
    - **Opt-in, and off by default**, because turning it on surfaces real drift. TypeScript only
      excess-property-checks object _literals_, so a service returning a database row with undeclared
      columns satisfies `const result: User` today and quietly ships them; under the default `strict`
      mode that becomes a 500. That is the flag working, but it is not a change to make on a Friday.
    - **`zod: true` is a hard prerequisite.** Without it `output.types` emits plain interfaces — types
      with no runtime schema value to validate against. Setting `validateResponses` alone now fails the
      build with an explicit message instead of emitting code that cannot compile. This is the plugin's
      first config assertion; it runs for both the default export and `createTypescriptPlugin`.
    - **Requires `@maroonedsoftware/zod` 0.6.1 or later** for the `statusCode` argument. Failures are
      raised as `500`, not the `400` a request-side failure gets — a service breaking its own contract
      is a server fault. At 5xx that package puts the field-level map on `internalDetails` rather than
      `details`, so `errorMiddleware` keeps it out of the response body and on the log path.

    Two kinds of response body are deliberately left unvalidated, and generate exactly as before:
    - **Anything transitively referencing a model with `format(input=…)` or `format(output=…)`.** Those
      schemas transform keys between wire and developer-facing casing, and the service already returns
      the post-transform shape, so re-parsing it through the same schema would fail on every key. Note
      this needs a wider set than `modelsWithOutput`, which seeds only from `outputCase` because only
      that case needs an `Output` type alias — a `format(input=snake)`-only model is just as
      untouchable. `@contractkit/core` gains `computeModelsWithCaseTransform` for it.
    - **A status whose several content types carry different body shapes**, where `contentType` and
      `body` are correlated across union members. Matching shapes (`image/png` and `image/jpeg` both
      `binary`) share one schema and validate normally.

    One wart worth knowing: `ctx.status` and any `ctx.set(…)` response headers are written before the
    body, so a validation failure raises its 500 with the success path's headers already set.

    Projects that do not set the flag generate byte-identical routers.

### Patch Changes

- 5dc2693: Stop the generated Koa router emitting imports nothing in the file references

    `collectTypes` and `collectServices` walk the AST, and the AST over-approximates what a router
    actually uses in three ways:
    - A model with an `Input` or `Output` variant contributed **both** its base name and the variant,
      even when only the variant is ever annotated. A response typed `AuthTokenOutput` emitted
      `import { AuthToken, AuthTokenOutput }`, and a request body validated against `CreateUserInput`
      emitted `import { CreateUser, CreateUserInput }`.
    - Both collectors walk every operation, including the `internal` ones `includeInternal: false`
      drops. A router whose only operation was excluded still imported that operation's service and
      response model, with no handler left to use either.

    In a consuming project with `noUnusedLocals` — or the equivalent lint rule — each of those is a
    compile error in generated code the user cannot edit.

    Every collected service and model name is now filtered through the same `uses` gate that already
    prunes `parseAndValidate`, `requirePolicy`, `MultipartBody` and the luxon imports: a name is
    imported only if it appears in the generated body. This is the approach the file's own comment
    already argued for — deciding imports from the emitted text rather than from predicates over the
    AST that have to be kept in step with it by hand.

    Names that are genuinely used are unaffected, including a base model used as the runtime schema
    under `server.validateResponses`. `@contractkit/plugin-typescript`'s MCP output does not have this
    gap — its schema ids and service imports are both derived from the emitted tool plans.

- Updated dependencies [aea5e21]
- Updated dependencies [5dc2693]
    - @contractkit/core@0.27.0

## 0.31.2

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.
- Updated dependencies [ca1c139]
    - @contractkit/core@0.26.1

## 0.31.1

### Patch Changes

- Updated dependencies [ab69718]
    - @contractkit/core@0.26.0

## 0.31.0

### Minor Changes

- 85d7566: Let an operation emit more than one status, and a status serve more than one content type.

    A status code could previously declare only one mime — the parser warned `Duplicate response body` and dropped the rest — and the generated router pinned both `ctx.status` and `ctx.type` to whichever response happened to be listed first with a body. An endpoint serving several formats had to declare one lying mime and let browsers sniff, and a service had no way to say which status it produced.

    A status now holds every declared `mime: Type` line (`OpResponseNode.bodies`). When there is more than one, the service picks at runtime and the router sets `ctx.type` from the returned `contentType`. When an operation produces more than one status, the service returns a union discriminated on `status` and the handler switches on it, so each status writes only its own headers, mime and body. Both SDKs mirror the router: the TypeScript and Python clients return a matching union, report which mime came back, and pass the non-2xx statuses they expect to the shared fetch so a declared `304` no longer surfaces as an error. `SdkError` now takes a body type parameter, and each operation exports a `…ErrorBody` alias for the statuses that stay on the throw path.

    Which statuses the service produces is derived from the declaration: **a status is emitted if it has a block, or is 2xx.** An empty block (`304: {}`) says the service returns that status carrying nothing; a bare `304:` says it is documented and something else produces it. `404(documented): { … }` is the one modifier, forcing a block-carrying status back out.

    Two long-standing bugs in the same area go with it. The formatter deleted any comment written inside a `response` block — above a status code, above a mime line, above a `headers:` block, or before a closing brace — so `pnpm format` silently threw away the notes explaining why a contract looks the way it does; all four positions now round-trip. And the generated router declared a `_ZodBinary` helper for a binary _response_ body, which is a plain `Buffer` annotation with no schema behind it, leaving an unused const that tripped `noUnusedLocals` downstream; helpers are now chosen from the code that was actually generated, the same way imports already were.

    **If you are already on a pre-release version, two things change under you.** A contract that declares a body on an error status — `404: { application/json: Problem }` alongside a `200` — now returns it from the service instead of throwing, and the SDK return type becomes a union; add `(documented)` to that status to keep the previous behaviour. Contracts whose error statuses are bodyless (`400:`, `404:`) are unaffected. Anything reading the AST directly should move from `OpResponseNode.contentType`/`bodyType` to `bodies`, which replaces them.

### Patch Changes

- Updated dependencies [85d7566]
- Updated dependencies [90d19ee]
    - @contractkit/core@0.25.0

## 0.30.0

### Minor Changes

- 23e4beb: Stop emitting unused imports in generated Koa routers. `bodyParserMiddleware` was imported unconditionally even when no operation declared a request body, and `MultipartBody` was imported whenever any body was multipart — including when the multipart body is structurally equal to its sibling MIME types and the handler collapses to a single `parseAndValidate` call that never references it. `requirePolicy`, `requireSignature` and `parseAndValidate` could also go unused when `includeInternal: false` skipped the only handlers that needed them. Each unused import trips `noUnusedLocals` and lint in the consuming project.

    Imports are now derived from the generated body — a symbol is emitted only if it actually appears in the output — rather than from predicates over the AST that had to be kept in step by hand.

### Patch Changes

- Updated dependencies [23e4beb]
    - @contractkit/core@0.24.0

## 0.29.0

### Minor Changes

- 79e3049: Fix scalar response bodies in generated Koa routers, which emitted the `.ck` scalar name verbatim as a TypeScript type (`const result: binary`). Only `string`, `number`, `boolean`, `bigint`, `null` and `unknown` compiled by coincidence; `binary`, `int`, `uuid`, `datetime` and friends produced invalid code. Scalars now render as the type the handler actually receives: `binary` → `Buffer`, `int` → `number`, `datetime` → luxon `DateTime`, `interval` → `string`, `json` → `_JsonValue`.

    Generated routers now also import `Duration` and `Interval` from luxon and emit the `_ZodInterval` helper when an operation uses those scalars, instead of referencing undefined names.

    Plain type files emitted for the server render `binary` as `Buffer` rather than `Blob`. SDK output is unchanged. The standalone `types` sub-generator gained a `target` option (`"client" | "server"`, default `"client"`) to select between the two.

## 0.28.2

### Patch Changes

- ca9309a: Generated Koa route handlers now use `async ctx => {` instead of `async (ctx, next) => {`. The `next` argument was never referenced in the emitted body and tripped no-unused-vars lint rules in consuming projects.

## 0.28.1

### Patch Changes

- 2bf01f1: Escape `.ck` descriptions, enum values, and signature strings when generating Zod schemas and TypeScript so `*/`, quotes, or newlines can no longer break or inject into generated output. Contain every generated-file path within the configured output directory, rejecting `options { keys }` values that would escape it. Throw on an unmapped scalar type instead of silently emitting `z.unknown()`/`unknown`.
- Updated dependencies [2bf01f1]
    - @contractkit/core@0.23.0

## 0.28.0

### Minor Changes

- 8ac8343: Generated Koa routers now read the incoming request body from `ctx.parsedBody` instead of `ctx.body`, matching serverkit's refactor. The response body is still assigned via `ctx.body`.

## 0.27.0

### Minor Changes

- 0d3b8e2: Add opt-in `sdk.scaffold` to the TypeScript plugin, which emits a starter `package.json` and `tsconfig.json` at the SDK `baseDir` so generated output is a buildable, publishable package. Dependencies are derived from the contracts (`zod` when `zod: true`; `luxon`/`@types/luxon` when a date/time scalar is used). Scaffold files are write-once: a new `ctx.emitFile(path, content, { ifAbsent: true })` option writes them only when absent and never overwrites or orphan-deletes them, so disabling `scaffold` or editing the files later is always safe.

### Patch Changes

- Updated dependencies [0d3b8e2]
    - @contractkit/core@0.22.0

## 0.26.0

### Minor Changes

- fff30df: Add a block form to the operation `signature:` key. Alongside the existing bare form (`signature: KEY`), you can now write `signature: { options: KEY, policy: name }` to attach a signature-scoped policy. The policy is passed through to the generated `requireSignature(KEY, { policy: name })` middleware and surfaces in OpenAPI-to-`.ck` output, Markdown docs, and the explorer UI. The bare form is unchanged and remains shorthand for a block with only `options:`.

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0

## 0.25.4

### Patch Changes

- c5e74a3: Emit the missing `import { MultipartBody } from '@maroonedsoftware/multipart'` in generated Koa routers when an operation declares a `multipart/form-data` request body.

## 0.25.3

### Patch Changes

- 5da85ca: Stop emitting `await next()` at the end of generated Koa route handlers — route handlers are the terminus of the middleware chain.

## 0.25.2

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0

## 0.25.1

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0

## 0.25.0

### Minor Changes

- dd8197b: **Breaking:** Replace the `requireMfa: boolean` field in `security: { ... }` blocks with `policy: <ident|none>`, and switch the generated Koa router middleware from `requireSecurity` to ServerKit's new `requirePolicy`.

    The `security` declaration on operations, routes, and the file-level `options { security: { ... } }` block no longer accepts a `requireMfa:` line. The new field is `policy:` and takes a bare identifier (the named policy) or the keyword `none` to explicitly bypass policy enforcement. Existing `.ck` files that use `requireMfa:` will fail to parse.

    ```ck
    # Before
    security: {
        requireMfa: true
    }

    # After
    security: {
        policy: paymentsWrite
    }

    # Explicit bypass
    security: {
        policy: none
    }
    ```

    **`@contractkit/core`** — `SecurityFields` interface drops `requireMfa` / `requireMfaDescription` and adds `policy?: string | false` / `policyDescription?: string`. The grammar's `SecurityRequireMfaLine` is replaced by `SecurityPolicyLine` (`policyKw ":" (noneKw | identifier)`). `security: none` (the route-level public sentinel) is unchanged.

    **`@contractkit/plugin-typescript`** — Generated Koa routers now import `requirePolicy` from `@maroonedsoftware/koa` (previously `requireSecurity`) and emit `requirePolicy({ policy: 'name' })`, `requirePolicy({ policy: false })`, or bare `requirePolicy()`. Consumers must upgrade ServerKit alongside.

    **`@contractkit/prettier-plugin`** — Formats `policy: <name>` and `policy: none` lines inside security blocks. Files containing `requireMfa:` will no longer round-trip and will surface as parse errors.

    **`@contractkit/plugin-markdown`** — The "Security: authenticated" admonition now shows `policy: <name|none>` instead of `requireMfa: <bool>`.

    **`@contractkit/openapi-to-ck`** — Non-empty OpenAPI `security` requirements continue to collapse to an empty `security: {}` (authenticated, default policy); the serializer now emits `policy:` lines when the field is set.

    **`contractkit-vscode-extension`** — TextMate grammar highlights `policy:` inside the security block; LSP completion offers `policy` instead of `requireMfa`. Re-run `pnpm run vscode:install` to pick up the change.

### Patch Changes

- Updated dependencies [dd8197b]
    - @contractkit/core@0.18.0

## 0.24.0

### Minor Changes

- 27521cc: Preserve the optional-field modality through `format(input=...)` / `format(output=...)` transforms. Optional fields are now emitted with a conditional spread (`...(data.x !== undefined ? { k: data.x } : {})` for output, `... != null` for input) so the inferred `z.input` / `z.output` type widens the property to `k?: T` instead of required-nullable `k: T | undefined`. Consumer code that constructs values with `...(x ? { k: x } : {})` is now assignable to the schema's inferred type. Runtime wire output is unchanged.

## 0.23.1

### Patch Changes

- 22c4a0b: Coerce `null` to `undefined` for optional fields in model-level `format(input=...)` / `format(output=...)` transforms, matching the existing behavior for inline objects.

## 0.23.0

### Minor Changes

- ff6f8ea: Expose response headers on `SdkError`. The generated error now carries `headers: Headers` (the raw `Headers` instance from the failed response) alongside `status`, `statusText`, and `body`, so catchers can read things like `X-Request-ID`, `Retry-After`, or `WWW-Authenticate` for logging, retry logic, and rate-limit handling.

## 0.22.0

### Minor Changes

- 79af33b: **Breaking:** Replace the `roles` field in `security: { ... }` blocks with `requireMfa: boolean`.

    The `security` declaration on operations, routes, and the file-level `options { security: { ... } }` block no longer accepts a `roles:` line. The new field is `requireMfa: true | false`. Existing `.ck` files that use `roles:` will fail to parse.

    ```ck
    # Before
    security: {
        roles: admin editor
    }

    # After
    security: {
        requireMfa: true
    }
    ```

    **`@contractkit/core`** — `SecurityFields` interface drops `roles` / `rolesDescription` and adds `requireMfa` / `requireMfaDescription`. The grammar's `SecurityRolesLine` is replaced by `SecurityRequireMfaLine` (`requireMfaKw ":" booleanLit`). `security: none` continues to work.

    **`@contractkit/plugin-typescript`** — Generated Koa routers now emit `requireSecurity({ requireMfa: <bool> })` when `requireMfa` is set, and bare `requireSecurity()` for unannotated routes (previously `requireSecurity({ roles: [...] })` / `requireSecurity({  })`). The generated code matches the updated serverkit `SecurityOptions = { requireMfa: boolean }` signature; consumers must upgrade serverkit alongside.

    **`@contractkit/prettier-plugin`** — Formats `requireMfa: true|false` lines inside security blocks. Files containing `roles:` will no longer round-trip and will surface as parse errors.

    **`@contractkit/plugin-markdown`** — The "Security: authenticated" admonition now shows `requireMfa: <bool>` instead of `roles: <list>`.

    **`@contractkit/openapi-to-ck`** — `convertSecurity` no longer extracts OpenAPI scopes into a `roles` list (those don't map onto MFA semantics). Any non-empty OpenAPI `security` requirement now collapses to `security: {}` (authenticated, no MFA flag).

### Patch Changes

- Updated dependencies [79af33b]
    - @contractkit/core@0.17.0

## 0.21.0

### Minor Changes

- 2aad136: Move `<Area>Client` classes out of `sdk.ts` and into their own `<area>.client.ts` files. Previously the SDK aggregator declared the `<Area>Client` class inline and merged area-level methods into it; now the merged class is emitted to a synthesized `<area>.client.ts` next to its leaf subarea clients, and `sdk.ts` only imports it. The aggregator is now a thin file: imports + a `Sdk` class with property wiring.

    The area-client output path is derived from the same `output.clients` template as leaf clients via the new `computeSdkAreaClientOutPath` helper — `{filename}` and `{area}` substitute to the area name, `{subarea}` to empty (with double-slashes collapsed and any hidden `.client.ts` segment fixed up). For typical templates like `src/{area}/{subarea}.client.ts` or `src/{area}/{filename}.client.ts`, this produces `src/<area>/<area>.client.ts`.

    `generateSdkAggregator`'s `SdkAreaInfo` shape changed: `inlineFiles` and `subareaClients` are gone — the aggregator now takes a single `client: SdkClientInfo` per area pointing at the new file. Plugins / tooling consuming `generateSdkAggregator` directly need to update. The new `generateAreaClient` function takes the inline-file list + subarea clients and returns the `<area>.client.ts` content. Per-area cache units mean a change to one file's ops only re-renders that area's client.

    Consumers who imported an `<Area>Client` type directly from `sdk.ts` need to import from `./<area>/<area>.client.ts` (or `./<area>/<area>.js` after compile) instead — `Sdk` and `SdkOptions` continue to come from `sdk.ts`.

## 0.20.0

### Minor Changes

- 4ac6d4d: Move plugin incremental-build manifests under the CLI cache directory (default `.contractkit/cache/`, configurable via `config.cache.dir`). Bruno's `.contractkit-bruno-manifest.json` (in the bruno-collection dir), Python's `.contractkit-python-manifest.json` (in the python-sdk dir), and TypeScript's `.contractkit-typescript-manifest.json` (at rootDir) now all live as `bruno-manifest.json` / `python-manifest.json` / `typescript-manifest.json` under `ctx.cacheDir`, alongside the CLI's existing `build.json` and HTTP cache. Output dirs no longer contain build state.

    `PluginContext` gains a `cacheDir: string` field. `runIncrementalCodegen` no longer takes a `manifestFilename` argument and no longer bundles the manifest into `filesToWrite` — the result's `manifest` is returned separately so plugins can persist it wherever they want. New helper `serializeIncrementalManifest(manifest)` produces the JSON form.

    After upgrading, the old in-output manifests can be deleted manually (or with `--force`); plugins will simply do a full regen on the first run since they won't find a manifest at the new path.

### Patch Changes

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0

## 0.19.1

### Patch Changes

- 130d53b: Fix `stableStringify` (and therefore `hashFingerprint` / `runIncrementalCodegen`) crashing with "Do not know how to serialize a BigInt" when an AST payload contains a `bigint` default or literal. Bigints now serialize as a tagged string `"<bigint:VALUE>"` so they're stable in fingerprints and distinguishable from plain strings. `undefined` is also normalized to `null` so `{a: undefined}` and `{}` don't collide.
- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1

## 0.19.0

### Minor Changes

- 10ca07b: Add per-output incremental caching to the Bruno, Python, and TypeScript plugins. Editing a single contract or operation no longer regenerates every output file — only the units whose transitive inputs actually changed are re-rendered, with the rest reused from a per-plugin manifest. `@contractkit/core` exposes the shared utility (`runIncrementalCodegen`, `parseIncrementalManifest`, `hashFingerprint`, `collectTransitiveModelRefs`, manifest types) for plugin authors. `PluginContext` gains a `cacheEnabled` flag so plugins can honor `--force` / `cache: false`.

### Patch Changes

- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0

## 0.18.0

### Minor Changes

- 6f8e3b6: Group TypeScript SDK clients by `keys.area` and `keys.subarea`. Files declaring `subarea` produce a leaf `<Area><Subarea>Client` exposed at `sdk.<area>.<subarea>`; area-only files (no subarea) inline their methods directly onto a synthesized `<Area>Client` and surface as `sdk.<area>.<method>`. Files with no area keep the legacy flat `sdk.<filename>` shape.

    `{subarea}` is a new path-template variable on `output.clients` and `output.types`, enabling layouts like `src/{area}/{subarea}.client.ts`. Multiple area-level files merging into one client throw a codegen-time error if any method names collide — disambiguate with `sdk:` or move into a subarea.

    Breaking: area-level files no longer emit a standalone `*.client.ts` (their methods live on the area client in `sdk.ts`). The `generateSdkAggregator` signature now takes a structured `SdkAggregatorInput` rather than `(clients, importPath?, className?)`.

## 0.17.5

### Patch Changes

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0

## 0.17.4

### Patch Changes

- 684a639: Fix plain TypeScript codegen producing invalid `extends` clauses when a child contract redeclares an inherited field without the explicit `override` keyword (e.g. narrowing `kind: BusinessRoleKind` to `kind: 'employee'`). The base is now wrapped in `Omit<Base, 'fieldName'>` for any redeclared field, matching the behaviour for explicit `override` fields.

## 0.17.3

### Patch Changes

- 1247514: Fix `override readonly` fields not being omitted from child Input schemas in Zod codegen

## 0.17.2

### Patch Changes

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.17.1

### Patch Changes

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.17.0

### Minor Changes

- b3f7da9: Fix `ref & ref` type alias intersections generating `ZodIntersection` instead of `ZodObject`

    Contracts like `contract Foo: A & B` (two model refs, no inline fields) previously emitted `A.and(B)`, producing a `ZodIntersection`. This broke `.strict()` calls on the result and caused each strict schema to reject the other's keys at runtime.

    All three rendering paths (`renderIntersection`, `renderInputType`, `renderQueryType`) now emit `.extend(B.shape)` chains for any `ref & (ref | inlineObject)*` intersection, matching the pattern already used for multi-base model inheritance.

## 0.16.1

### Patch Changes

- Updated dependencies [c9f2166]
    - @contractkit/core@0.11.0

## 0.16.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.15.0

### Minor Changes

- e27b771: Add an `includeInternal: boolean` config option to every plugin so consumers can override whether `internal` operations are emitted. Defaults preserve today's behavior: server router and Bruno default to `true` (include); TS SDK, Python SDK, OpenAPI, and Markdown default to `false` (exclude).

## 0.14.1

### Patch Changes

- 206120c: Fix double-anchoring in Zod regex codegen: patterns that already contain `^` or an unescaped trailing `$` are now emitted as-written instead of being wrapped a second time. Patterns without anchors continue to be auto-anchored to `^...$` for full-match semantics.

## 0.14.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0

## 0.13.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0

## 0.12.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0

## 0.11.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0

## 0.10.0

### Minor Changes

- ddb6a28: Refactor type generation in codegen-contract to use z.input for developer-facing types when outputCase is set. Updated tests to reflect this change in type handling for improved clarity in serialization logic.

## 0.9.0

### Minor Changes

- 2c9e9a9: Fix type casting in URLSearchParams serialization for form data in codegen-sdk. Updated tests to reflect changes in body serialization logic.

## 0.8.0

### Minor Changes

- 1b336ec: Enhance contract generation by introducing a flattening mechanism for format chains. This allows child models to inline parent fields and inherit transformations, ensuring compatibility with ZodPipe structures. Updated the model generation logic and added tests to verify the new behavior for child models extending formatted parents.

## 0.7.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/contractkit@0.5.0

## 0.6.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/contractkit@0.4.0

## 0.5.0

### Minor Changes

- 506af42: Enhance input type reference collection in code generation by adding support for tuple, record, union, intersection, lazy, and inlineObject types. Added corresponding test case for intersection query handling.

## 0.4.0

### Minor Changes

- 3d90443: Update ZodInterval transformation to include ISO string conversion in contract generation and corresponding test case.

## 0.3.0

### Minor Changes

- f396a68: Enhance scalar type support by adding 'interval' to the ContractKit

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
