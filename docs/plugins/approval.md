# Plugin approvals

Tools can opt into approval in two ways.

## Static approval

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

## Conditional approval

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
