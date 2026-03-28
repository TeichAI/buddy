import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../config/defaults.js";
import { createToolContext } from "./file-tools.js";
import { createToolRegistry } from "./registry.js";

async function writePlugin(params: {
  pluginDirectory: string;
  directoryName: string;
  packageName?: string;
  source: string;
}): Promise<void> {
  const pluginPath = path.join(params.pluginDirectory, params.directoryName);
  await fs.mkdir(pluginPath, { recursive: true });
  await fs.writeFile(
    path.join(pluginPath, "package.json"),
    `${JSON.stringify(
      {
        name: params.packageName ?? params.directoryName,
        version: "1.0.0",
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

test("createToolRegistry exposes plugin tools under normalized tool names", async () => {
  const pluginDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-registry-"));

  try {
    await writePlugin({
      pluginDirectory,
      directoryName: "weather-suite",
      source: `
        export default {
          id: "weather-suite",
          tools: [
            {
              id: "daily forecast",
              description: "Daily forecast.",
              parameters: { type: "object", additionalProperties: false },
              summarize() {
                return "Daily forecast";
              },
              async execute() {
                return "ok";
              }
            }
          ]
        };
      `
    });

    const registry = await createToolRegistry(defaultConfig, createToolContext(), { pluginDirectory });
    const toolNames = registry.definitions.map((definition) => definition.function.name);

    assert.ok(toolNames.includes("weather_suite__daily_forecast"));
    assert.ok(
      registry.promptLines.some((line) => line.includes("weather_suite__daily_forecast"))
    );
  } finally {
    await fs.rm(pluginDirectory, { recursive: true, force: true });
  }
});

test("createToolRegistry rejects duplicate normalized plugin tool names deterministically", async () => {
  const pluginDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-registry-dupes-"));

  try {
    await writePlugin({
      pluginDirectory,
      directoryName: "alpha",
      source: `
        export default {
          id: "weather-suite",
          tools: [
            {
              id: "forecast",
              description: "Alpha forecast.",
              parameters: { type: "object", additionalProperties: false },
              summarize() {
                return "Alpha forecast";
              },
              async execute() {
                return "alpha";
              }
            }
          ]
        };
      `
    });

    await writePlugin({
      pluginDirectory,
      directoryName: "beta",
      source: `
        export default {
          id: "weather_suite",
          tools: [
            {
              id: "forecast",
              description: "Beta forecast.",
              parameters: { type: "object", additionalProperties: false },
              summarize() {
                return "Beta forecast";
              },
              async execute() {
                return "beta";
              }
            }
          ]
        };
      `
    });

    const registry = await createToolRegistry(defaultConfig, createToolContext(), { pluginDirectory });
    const toolNames = registry.definitions.map((definition) => definition.function.name);

    assert.equal(toolNames.filter((name) => name === "weather_suite__forecast").length, 1);
    assert.ok(registry.diagnostics.some((diagnostic) => diagnostic.message.includes("collides")));
  } finally {
    await fs.rm(pluginDirectory, { recursive: true, force: true });
  }
});
