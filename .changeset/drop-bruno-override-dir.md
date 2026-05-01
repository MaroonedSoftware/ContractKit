---
'@contractkit/plugin-bruno': major
---

Drop the `overrideDir` config option from the Bruno plugin.

Per-operation overrides via `plugins: { bruno: "..." }` combined with the new `{{var}}` substitution in `.ck` files cover the same use cases more directly. Define a shared base path once in `options { keys: { bruno: "../bruno-overrides" } }` (or in the plugin's `keys` config in `contractkit.config.json` for a workspace-wide default) and reference per-operation override files with `plugins: { bruno: "{{bruno}}/path/to/file.yml" }`.

Migration: replace the `overrideDir` entry in your plugin config with a per-operation `plugins.bruno` declaration on each operation that needs an override.
