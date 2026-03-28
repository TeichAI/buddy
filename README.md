# Buddy

Buddy is a terminal-first AI assistant with a guided onboarding flow, a chat TUI, and support for either a local or remote server.

## Install

```bash
npm install -g @teichai/buddy
```

## Getting started

Run `buddy onboard` for a guided first-time setup. It starts by asking whether the Buddy server is local or remote, then walks you through provider setup, naming, and safety defaults one step at a time before a final review screen saves everything.

After onboarding:

- Run `buddy` to open the chat UI.
- Run `buddy config` to tweak advanced settings like Discord and blocked directories.
- Run `buddy server start` to launch the local server in the background when you want a dedicated daemon.

## Plugins

Buddy can auto-load custom tool plugins from `~/.buddy/plugins`. Each plugin lives in its own folder, ships a compiled ESM entrypoint, and can expose one or more tools to the model.

### Folder layout

```text
~/.buddy/plugins/
  weather-tools/
    package.json
    dist/
      index.js
```

Buddy scans each direct child directory of `~/.buddy/plugins` on every chat turn. The folder contents are the source of truth in v1, so there are no extra enable or disable flags yet.

### `package.json`

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

### Authoring API

Buddy exposes a TypeScript SDK at `@teichai/buddy/plugin`.

```ts
import { definePlugin, defineTool } from "@teichai/buddy/plugin";

export default definePlugin({
  id: "weather-tools",
  name: "Weather Tools",
  description: "Weather helpers for Buddy",
  author: "Acme, Inc.",
  repositoryUrl: "https://github.com/acme/weather-tools",
  tools: [
    defineTool({
      id: "forecast",
      description: "Fetch a weather forecast for a city.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City to look up." }
        },
        required: ["city"],
        additionalProperties: false
      },
      summarize(args) {
        return {
          summary: `Fetch forecast for ${String(args.city ?? "unknown city")}`,
          path: `weather:${String(args.city ?? "unknown")}`
        };
      },
      async execute(_context, args) {
        return `Sunny in ${String(args.city ?? "unknown")}`;
      }
    })
  ]
});
```

Plugin metadata:

- Required: `id`, `tools`
- Optional: `name`, `version`, `description`, `author`, `repositoryUrl`

`repositoryUrl` must be an absolute `http` or `https` URL if you provide it.

### Approval behavior

Tools can opt into approval in two ways.

Static approval:

```ts
defineTool({
  id: "dangerous-action",
  description: "Run a risky action.",
  requiresApproval: true,
  parameters: { type: "object", additionalProperties: false },
  summarize() {
    return { summary: "Run dangerous action", path: "dangerous-action" };
  },
  async execute() {
    return "done";
  }
});
```

Conditional approval from inside the tool:

```ts
import { defineTool, requestApproval } from "@teichai/buddy/plugin";

defineTool({
  id: "deploy",
  description: "Deploy the current release.",
  parameters: {
    type: "object",
    properties: {
      force: { type: "boolean" }
    },
    additionalProperties: false
  },
  summarize() {
    return { summary: "Deploy release", path: "release" };
  },
  async execute(_context, args) {
    if (args.force === true) {
      return requestApproval({
        summary: "Force deploy release",
        path: "release",
        reason: "Force mode bypasses the normal deployment checks.",
        continueWith: async () => "forced deploy complete"
      });
    }

    return "deploy complete";
  }
});
```

In v1, plugin permissions are Buddy approval semantics for tool calls. Plugins are still trusted in-process code.
