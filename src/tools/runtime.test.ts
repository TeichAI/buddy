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
}) {
  return createToolRuntime(
    {
      ...defaultConfig,
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
