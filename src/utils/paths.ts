import os from "node:os";
import path from "node:path";

export const buddyHome = path.join(os.homedir(), ".buddy");
export const configPath = path.join(buddyHome, "config.json");
export const currentPath = path.join(buddyHome, "current.json");
export const conversationsPath = path.join(buddyHome, "conversations");
export const discordContextsPath = path.join(buddyHome, "channels", "discord", "contexts.json");
export const workspacePath = path.join(buddyHome, "workspace");
export const secretTokenPath = path.join(buddyHome, "secret-token.txt");
export const websocketHost = "127.0.0.1";
export const websocketPort = 4317;
export const websocketUrl = `ws://${websocketHost}:${websocketPort}`;
