import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canSpawnBackgroundServer } from "./control.js";

test("canSpawnBackgroundServer accepts symlinked built cli entrypoints", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-server-control-"));
  const realEntry = path.join(tempDir, "index.js");
  const linkedEntry = path.join(tempDir, "buddy");

  try {
    await fs.writeFile(realEntry, "#!/usr/bin/env node\n", "utf8");
    await fs.symlink(realEntry, linkedEntry);

    assert.equal(canSpawnBackgroundServer(linkedEntry), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("canSpawnBackgroundServer rejects TypeScript dev entrypoints", () => {
  assert.equal(canSpawnBackgroundServer("/tmp/src/index.ts"), false);
});
