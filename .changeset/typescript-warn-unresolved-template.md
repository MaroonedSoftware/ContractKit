---
'@contractkit/plugin-typescript': patch
---

Warn when an output path template variable has no value.

`resolveTemplate` leaves an unknown `{key}` in place, and the result joins straight into the output path — so a config using `{area}` against a `.ck` file that declares no `options { keys { area: … } }` quietly wrote its files into a directory literally named `{area}`. `assertWithinBase` did not catch it: the path is inside the base directory, just wrong.

The build now says so, naming both the variable and the file it affected, and pointing at the two ways to fix it.

The file is still emitted. Throwing would be a worse trade here — the CLI catches a `generateTargets` throw and continues to the next plugin, so refusing over one misconfigured file would cost you that plugin's entire output. This adds visibility, not a new failure mode.

The check sits at the plugin's single `emitFile` funnel rather than being threaded down through the five path-computing helpers and their nine call sites. Every output path passes through that one point whichever helper built it, so one check covers all of them, and it catches a case a per-helper callback would miss.
