import os from "node:os";
import path from "node:path";

export const buddyHome = path.join(os.homedir(), ".buddy");
export const serverConfigPath = path.join(buddyHome, "config.json");
export const currentPath = path.join(buddyHome, "current.json");
export const conversationsPath = path.join(buddyHome, "conversations");
export const discordContextsPath = path.join(buddyHome, "channels", "discord", "contexts.json");
export const workspacePath = path.join(buddyHome, "workspace");
export const serverSecretTokenPath = path.join(buddyHome, "secret-token.txt");
export const cliHome = path.join(buddyHome, "cli");
export const cliConfigPath = path.join(cliHome, "config.json");
export const cliKeyPath = path.join(cliHome, "key.txt");
export const localWebsocketHost = "127.0.0.1";
export const localWebsocketPort = 4317;
export const localWebsocketUrl = `ws://${localWebsocketHost}:${localWebsocketPort}`;
