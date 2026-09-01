---
'@contractkit/core': minor
'@contractkit/cli': minor
---

Add an optional `warn` channel to `PluginContext`, so a plugin can report a non-fatal problem against the build's diagnostics.

Plugins previously had two options for a misconfiguration: emit something wrong and stay silent, or throw. Throwing is too blunt for a problem that affects one file — the CLI catches a `generateTargets` throw and continues to the next plugin, so a single bad path template would silently cost you that plugin's entire output.

```ts
ctx.warn?.('output path contains an unresolved {area}', file, line);
```

lands as `[plugin:typescript] output path contains an unresolved {area}` in the same diagnostics the rest of the build reports through.

The member is **optional**, and callers should use `ctx.warn?.(…)`. `PluginContext` is constructed as an object literal by test harnesses and by third-party tooling, and a required member would break every one of them at compile time.

`makePluginContext` takes the collector and the plugin name as a single argument, since a warning with no plugin name in it is not much use in a build log and the two should not be separable.

No plugin calls it yet and no generated output changes.
