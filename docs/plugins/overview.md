# Plugin overview

Buddy can auto-load custom tool plugins from `~/.buddy/plugins`. Each plugin lives in its own folder, ships a compiled ESM entrypoint, and can expose one or more tools to the model.

At runtime, plugins do not need their own private `node_modules/` just to import the Buddy SDK. Buddy resolves `@teichai/buddy/plugin` for them, and plugins can also reuse dependencies that are already available from Buddy or a shared parent `node_modules` such as `~/.buddy/plugins/node_modules`.

## Folder layout

```text
~/.buddy/plugins/
  weather-tools/
    package.json
    dist/
      index.js
```

Buddy scans each direct child directory of `~/.buddy/plugins` on every chat turn. The folder contents are the source of truth in v1, so there are no extra enable or disable flags yet.

## `package.json`

Each plugin folder must include a `package.json` with `name`, `version`, and `buddy.entry`:

```json
{
  "name": "@acme/weather-tools",
  "version": "1.0.0",
  "type": "module",
  "buddy": {
    "entry": "./dist/index.js"
  }
}
```

## Example Plugin

Find our example plugin [here](https://github.com/TeichAI/example-plugin).