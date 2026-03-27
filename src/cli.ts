import { isDefaultLocalServerUrl, loadCliConfig } from "./cli-config/store.js";
import { startServerInBackground, getServerStatus, stopServer } from "./server/control.js";
import { runSocketServer } from "./server/daemon.js";
import { runChatTui } from "./tui/app.js";
import { runConfigTui } from "./tui/config-app.js";

function printServerUsage(): void {
  console.log("Usage: buddy server <run|start|stop|status>");
}

async function runServerCommand(subcommand: string | undefined): Promise<void> {
  if (subcommand === "run") {
    await runSocketServer();
    return;
  }

  if (subcommand === "start") {
    await startServerInBackground();
    const status = await getServerStatus();
    if (!status.running) {
      throw new Error("The buddy server could not be reached after startup.");
    }
    console.log(`buddy server running in background (pid ${status.pid})`);
    return;
  }

  if (subcommand === "stop") {
    const stopped = await stopServer();
    console.log(stopped ? "buddy server stopped" : "buddy server is not running");
    return;
  }

  if (subcommand === "status") {
    const status = await getServerStatus();
    console.log(status.running ? `buddy server running (pid ${status.pid})` : "buddy server is not running");
    return;
  }

  printServerUsage();
}

async function maybeStartConfiguredLocalServer(): Promise<void> {
  const { serverUrl } = await loadCliConfig();
  if (!isDefaultLocalServerUrl(serverUrl)) {
    return;
  }

  try {
    await startServerInBackground();
  } catch {
    // Development runs and manual server lifecycles should not block the TUI from trying the socket directly.
  }
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  if (args[0] === "server") {
    await runServerCommand(args[1]);
    return;
  }

  if (args.includes("--config")) {
    await maybeStartConfiguredLocalServer();
    await runConfigTui();
    return;
  }

  await maybeStartConfiguredLocalServer();
  await runChatTui();
}
