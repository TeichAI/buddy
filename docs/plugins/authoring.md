# Plugin authoring

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
