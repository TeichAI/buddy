import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../config/defaults.js";
import { createToolContext } from "./file-tools.js";
import { createToolRegistry } from "./registry.js";
import { createToolRuntime } from "./runtime.js";
import type { ToolRuntimeEvent } from "./runtime.js";
import { workspacePath } from "../utils/paths.js";

async function createSupervisedRuntime(params?: {
  requestApproval?: () => Promise<boolean>;
  onEvent?: (event: ToolRuntimeEvent) => void;
  config?: typeof defaultConfig;
  pluginDirectory?: string;
}) {
  const pluginDirectory =
    params?.pluginDirectory ?? (await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-plugins-")));
  const config = {
    ...defaultConfig,
    ...params?.config,
    restrictions: {
      blockedDirectories: [],
      accessLevel: "supervised" as const
    }
  };
  const registry = await createToolRegistry(config, createToolContext(), { pluginDirectory });
  const runtime = createToolRuntime(config, registry, {
    requestApproval: params?.requestApproval ?? (async () => false),
    onEvent: params?.onEvent
  });

  return {
    runtime,
    async cleanup() {
      if (!params?.pluginDirectory) {
        await fs.rm(pluginDirectory, { recursive: true, force: true });
      }
    }
  };
}

async function writePlugin(params: {
  pluginDirectory: string;
  directoryName: string;
  packageName?: string;
  version?: string;
  source: string;
}): Promise<void> {
  const pluginPath = path.join(params.pluginDirectory, params.directoryName);
  await fs.mkdir(pluginPath, { recursive: true });
  await fs.writeFile(
    path.join(pluginPath, "package.json"),
    `${JSON.stringify(
      {
        name: params.packageName ?? params.directoryName,
        version: params.version ?? "1.0.0",
        type: "module",
        buddy: {
          entry: "./plugin.js"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(pluginPath, "plugin.js"), `${params.source}\n`, "utf8");
}

test("supervised mode requests approval before listing directories outside the workspace", async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-outside-"));
  const events: ToolRuntimeEvent[] = [];
  let approvalRequested = false;
  const { runtime, cleanup } = await createSupervisedRuntime({
    requestApproval: async () => {
      approvalRequested = true;
      return false;
    },
    onEvent: (event) => events.push(event)
  });

  try {
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "classified\n", "utf8");
    const result = await runtime.executeTool("list_directory", JSON.stringify({ path: outsideDir }));

    assert.equal(approvalRequested, true);
    assert.equal(result.ok, false);
    assert.match(result.output, /User denied approval/);
    assert.equal(events[0]?.status, "awaiting_approval");
    assert.equal(events[1]?.status, "denied");
  } finally {
    await cleanup();
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("supervised mode requests approval before reading files outside the workspace", async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-file-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  let approvalRequested = false;
  const { runtime, cleanup } = await createSupervisedRuntime({
    requestApproval: async () => {
      approvalRequested = true;
      return false;
    }
  });

  try {
    await fs.writeFile(outsideFile, "classified\n", "utf8");
    const result = await runtime.executeTool("read_file", JSON.stringify({ path: outsideFile }));

    assert.equal(approvalRequested, true);
    assert.equal(result.ok, false);
    assert.match(result.output, /User denied approval/);
  } finally {
    await cleanup();
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("supervised mode treats symlink escapes as outside-workspace access and requests approval", async () => {
  await fs.mkdir(workspacePath, { recursive: true });

  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-symlink-target-"));
  const workspaceDir = await fs.mkdtemp(path.join(workspacePath, "runtime-symlink-"));
  const symlinkPath = path.join(workspaceDir, "desktop-link");
  const { runtime, cleanup } = await createSupervisedRuntime({
    requestApproval: async () => false
  });

  try {
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "classified\n", "utf8");
    await fs.symlink(outsideDir, symlinkPath);

    const result = await runtime.executeTool("list_directory", JSON.stringify({ path: symlinkPath }));

    assert.equal(result.ok, false);
    assert.match(result.output, /User denied approval/);
  } finally {
    await cleanup();
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("supervised mode allows outside-workspace access after approval", async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-approved-"));
  const { runtime, cleanup } = await createSupervisedRuntime({
    requestApproval: async () => true
  });

  try {
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "classified\n", "utf8");

    const result = await runtime.executeTool("list_directory", JSON.stringify({ path: outsideDir }));

    assert.equal(result.ok, true);
    assert.match(result.output, /\[file\] secret.txt/);
  } finally {
    await cleanup();
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("disabled tools are omitted from the registry", async () => {
  const { runtime, cleanup } = await createSupervisedRuntime({
    config: {
      ...defaultConfig,
      tools: {
        webSearch: {
          enabled: false
        }
      }
    }
  });

  try {
    const result = await runtime.executeTool("web_search", JSON.stringify({ query: "latest TypeScript release" }));
    assert.equal(result.ok, false);
    assert.equal(result.output, "Unknown tool: web_search");
  } finally {
    await cleanup();
  }
});

test("web_search scrapes DuckDuckGo HTML and fetches only the top 3 result pages", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);

    if (url.startsWith("https://html.duckduckgo.com/html/")) {
      return new Response(
        `
          <html>
            <body>
              <a class="result__a" href="https://example.com/one">First result</a>
              <div class="result__snippet">First snippet</div>
              <a class="result__a" href="https://example.com/two">Second result</a>
              <div class="result__snippet">Second snippet</div>
              <a class="result__a" href="https://example.com/three">Third result</a>
              <div class="result__snippet">Third snippet</div>
              <a class="result__a" href="https://example.com/four">Fourth result</a>
              <div class="result__snippet">Fourth snippet</div>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    }

    if (url === "https://example.com/one") {
      return new Response(
        "<html><head><title>One page</title></head><body><main>Alpha body text.</main></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    }

    if (url === "https://example.com/two") {
      return new Response(
        "<html><head><title>Two page</title></head><body><article>Beta body text.</article></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    }

    if (url === "https://example.com/three") {
      return new Response("Gamma body text.", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof globalThis.fetch;

  const { runtime, cleanup } = await createSupervisedRuntime({
    config: {
      ...defaultConfig,
      tools: {
        webSearch: {
          enabled: true
        }
      }
    }
  });

  try {
    const result = await runtime.executeTool("web_search", JSON.stringify({ query: "buddy search" }));

    assert.equal(result.ok, true);
    assert.match(result.output, /Web search results for "buddy search"/);
    assert.match(result.output, /First result/);
    assert.match(result.output, /Second result/);
    assert.match(result.output, /Third result/);
    assert.doesNotMatch(result.output, /Fourth result/);
    assert.match(result.output, /Alpha body text\./);
    assert.match(result.output, /Beta body text\./);
    assert.match(result.output, /Gamma body text\./);
    assert.deepEqual(calls, [
      "https://html.duckduckgo.com/html/?q=buddy+search",
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three"
    ]);
  } finally {
    await cleanup();
    globalThis.fetch = originalFetch;
  }
});

test("plugin tools can require approval before execution", async () => {
  const pluginDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-plugin-static-"));
  let approvalCount = 0;

  await writePlugin({
    pluginDirectory,
    directoryName: "weather",
    source: `
      export default {
        id: "weather",
        tools: [
          {
            id: "forecast",
            description: "Get the forecast.",
            requiresApproval: true,
            parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false },
            summarize(args) {
              return { summary: "Fetch weather forecast", path: String(args.city ?? "weather") };
            },
            async execute(_context, args) {
              return "Forecast for " + String(args.city ?? "unknown");
            }
          }
        ]
      };
    `
  });

  const { runtime } = await createSupervisedRuntime({
    pluginDirectory,
    requestApproval: async () => {
      approvalCount += 1;
      return true;
    }
  });

  try {
    const result = await runtime.executeTool("weather__forecast", JSON.stringify({ city: "Austin" }));
    assert.equal(result.ok, true);
    assert.equal(result.output, "Forecast for Austin");
    assert.equal(approvalCount, 1);
  } finally {
    await fs.rm(pluginDirectory, { recursive: true, force: true });
  }
});

test("plugin tools can request approval conditionally after their own checks", async () => {
  const pluginDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-plugin-conditional-"));
  const events: ToolRuntimeEvent[] = [];

  await writePlugin({
    pluginDirectory,
    directoryName: "deployments",
    source: `
      export default {
        id: "deployments",
        tools: [
          {
            id: "ship_it",
            description: "Ship a release.",
            parameters: { type: "object", properties: { force: { type: "boolean" } }, additionalProperties: false },
            summarize() {
              return { summary: "Ship release", path: "release" };
            },
            async execute(_context, args) {
              if (args.force === true) {
                return {
                  __buddyType: "approval_request",
                  summary: "Force ship release",
                  path: "release",
                  reason: "Force mode bypasses the normal release checks.",
                  continueWith: async () => "forced release"
                };
              }

              return "standard release";
            }
          }
        ]
      };
    `
  });

  const { runtime } = await createSupervisedRuntime({
    pluginDirectory,
    requestApproval: async () => true,
    onEvent: (event) => events.push(event)
  });

  try {
    const result = await runtime.executeTool("deployments__ship_it", JSON.stringify({ force: true }));
    assert.equal(result.ok, true);
    assert.equal(result.output, "forced release");
    assert.deepEqual(
      events.map((event) => event.status),
      ["running", "awaiting_approval", "running", "completed"]
    );
    assert.equal(events[1]?.summary, "Force ship release");
    assert.equal(events[1]?.source?.pluginId, "deployments");
  } finally {
    await fs.rm(pluginDirectory, { recursive: true, force: true });
  }
});
