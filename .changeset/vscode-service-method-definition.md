---
'contractkit-vscode-extension': minor
---

Go-to-definition on an operation's `service:` method now jumps into the TypeScript service source. Placing the cursor on the method segment (the `getById` in `service: PetService.getById`) resolves the service's module path relative to the TS plugin's `server.baseDir` (from `contractkit.config.json`) via the generated server's `package.json` `imports` map or the nearest `tsconfig.json` `compilerOptions.paths`, maps the compiled `.js` back to `.ts`, and lands on the method declaration (falling back to the file top, then to the `.ck` service declaration).
