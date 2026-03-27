import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../config/defaults.js";
import { workspacePath } from "../utils/paths.js";
import { createToolRuntime } from "./runtime.js";
import type { ToolRuntimeEvent } from "./runtime.js";

function createSupervisedRuntime(params?: {
  requestApproval?: () => Promise<boolean>;
  onEvent?: (event: ToolRuntimeEvent) => void;
  config?: typeof defaultConfig;
}) {
  return createToolRuntime(
    {
      ...defaultConfig,
      ...params?.config,
      restrictions: {
        blockedDirectories: [],
        accessLevel: "supervised"
      }
    },
    {
      requestApproval: params?.requestApproval ?? (async () => false),
      onEvent: params?.onEvent
    }
  );
}

test("supervised mode requests approval before listing directories outside the workspace", async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-outside-"));
  const events: ToolRuntimeEvent[] = [];
  let approvalRequested = false;

  try {
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "classified\n", "utf8");

    const runtime = createSupervisedRuntime({
      requestApproval: async () => {
        approvalRequested = true;
        return false;
      },
      onEvent: (event) => events.push(event)
    });
    const result = await runtime.executeTool("list_directory", JSON.stringify({ path: outsideDir }));

    assert.equal(approvalRequested, true);
    assert.equal(result.ok, false);
    assert.match(result.output, /User denied approval/);
    assert.equal(events[0]?.status, "awaiting_approval");
    assert.equal(events[1]?.status, "denied");
  } finally {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("supervised mode requests approval before reading files outside the workspace", async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-file-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  let approvalRequested = false;

  try {
    await fs.writeFile(outsideFile, "classified\n", "utf8");

    const runtime = createSupervisedRuntime({
      requestApproval: async () => {
        approvalRequested = true;
        return false;
      }
    });
    const result = await runtime.executeTool("read_file", JSON.stringify({ path: outsideFile }));

    assert.equal(approvalRequested, true);
    assert.equal(result.ok, false);
    assert.match(result.output, /User denied approval/);
  } finally {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("supervised mode treats symlink escapes as outside-workspace access and requests approval", async () => {
  await fs.mkdir(workspacePath, { recursive: true });

  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-symlink-target-"));
  const workspaceDir = await fs.mkdtemp(path.join(workspacePath, "runtime-symlink-"));
  const symlinkPath = path.join(workspaceDir, "desktop-link");

  try {
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "classified\n", "utf8");
    await fs.symlink(outsideDir, symlinkPath);

    const runtime = createSupervisedRuntime({
      requestApproval: async () => false
    });
    const result = await runtime.executeTool("list_directory", JSON.stringify({ path: symlinkPath }));

    assert.equal(result.ok, false);
    assert.match(result.output, /User denied approval/);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("supervised mode allows outside-workspace access after approval", async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-runtime-approved-"));

  try {
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "classified\n", "utf8");

    const runtime = createSupervisedRuntime({
      requestApproval: async () => true
    });
    const result = await runtime.executeTool("list_directory", JSON.stringify({ path: outsideDir }));

    assert.equal(result.ok, true);
    assert.match(result.output, /\[file\] secret.txt/);
  } finally {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test("web_search returns a config error when the tool is disabled", async () => {
  const runtime = createSupervisedRuntime({
    config: {
      ...defaultConfig,
      tools: {
        webSearch: {
          enabled: false
        }
      }
    }
  });
  const result = await runtime.executeTool("web_search", JSON.stringify({ query: "latest TypeScript release" }));

  assert.equal(result.ok, false);
  assert.equal(result.output, "Web search is disabled in buddy config.");
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

  try {
    const runtime = createSupervisedRuntime({
      config: {
        ...defaultConfig,
        tools: {
          webSearch: {
            enabled: true
          }
        }
      }
    });

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
    globalThis.fetch = originalFetch;
  }
});
