import { spawn } from "node:child_process";
import path from "node:path";
import { BuddySocketClient } from "./client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canSpawnBackgroundServer(): boolean {
  return path.extname(process.argv[1] || "") === ".js";
}

export async function getServerStatus(): Promise<{ running: boolean; pid?: number }> {
  const client = new BuddySocketClient();

  try {
    const status = await client.getStatus();
    await client.close();
    return {
      running: true,
      pid: status.pid
    };
  } catch {
    return {
      running: false
    };
  }
}

export async function stopServer(): Promise<boolean> {
  const client = new BuddySocketClient();

  try {
    await client.shutdownServer();
    await client.close();
    return true;
  } catch {
    return false;
  }
}

export async function startServerInBackground(): Promise<void> {
  if (!canSpawnBackgroundServer()) {
    throw new Error("Background start is only supported from the built CLI. Use `npm run dev:server` while developing.");
  }

  const existing = await getServerStatus();
  if (existing.running) {
    return;
  }

  const child = spawn(process.execPath, [process.argv[1], "server", "run"], {
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = await getServerStatus();
    if (status.running) {
      return;
    }
    await sleep(100);
  }

  throw new Error("The buddy server did not start within 5 seconds.");
}
