import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPlugins } from "./loader.js";

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

test("loadPlugins reads optional plugin metadata from the plugin export", async () => {
  const pluginDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-loader-"));

  try {
    await writePlugin({
      pluginDirectory,
      directoryName: "weather",
      packageName: "@acme/weather",
      version: "2.0.0",
      source: `
        export default {
          id: "weather",
          name: "Weather Tools",
          description: "Weather helpers",
          author: "Teich AI",
          repositoryUrl: "https://github.com/teichai/weather",
          tools: [
            {
              id: "forecast",
              description: "Get a forecast.",
              parameters: { type: "object", additionalProperties: false },
              summarize() {
                return "Forecast";
              },
              async execute() {
                return "ok";
              }
            }
          ]
        };
      `
    });

    const result = await loadPlugins(pluginDirectory);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.plugins.length, 1);
    assert.equal(result.plugins[0]?.plugin.author, "Teich AI");
    assert.equal(result.plugins[0]?.plugin.repositoryUrl, "https://github.com/teichai/weather");
    assert.equal(result.plugins[0]?.plugin.name, "Weather Tools");
    assert.equal(result.plugins[0]?.plugin.version, "2.0.0");
  } finally {
    await fs.rm(pluginDirectory, { recursive: true, force: true });
  }
});

test("loadPlugins reports invalid metadata and duplicate plugin ids without crashing", async () => {
  const pluginDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-loader-dupes-"));

  try {
    await writePlugin({
      pluginDirectory,
      directoryName: "first",
      source: `
        export default {
          id: "shared",
          tools: [
            {
              id: "one",
              description: "One.",
              parameters: { type: "object", additionalProperties: false },
              summarize() {
                return "One";
              },
              async execute() {
                return "ok";
              }
            }
          ]
        };
      `
    });

    await writePlugin({
      pluginDirectory,
      directoryName: "second",
      source: `
        export default {
          id: "shared",
          repositoryUrl: "notaurl",
          tools: [
            {
              id: "two",
              description: "Two.",
              parameters: { type: "object", additionalProperties: false },
              summarize() {
                return "Two";
              },
              async execute() {
                return "ok";
              }
            }
          ]
        };
      `
    });

    const result = await loadPlugins(pluginDirectory);
    assert.equal(result.plugins.length, 1);
    assert.equal(result.plugins[0]?.plugin.id, "shared");
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]?.message ?? "", /repositoryUrl/);
  } finally {
    await fs.rm(pluginDirectory, { recursive: true, force: true });
  }
});
