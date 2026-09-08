---
'contractkit-vscode-extension': patch
---

Ship a production build to the VS Code Marketplace: minify the client, server, and
webview bundles behind a new `--production` esbuild flag, drop source maps, tests, and
turbo logs from the VSIX, and publish from the release workflow. Packaged size drops
from 1.7 MB to 559 KB.
