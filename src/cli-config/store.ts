import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadServerSecretToken } from "../config/store.js";
import { buddyHome, cliConfigPath, cliHome, cliKeyPath, localWebsocketUrl, serverSecretTokenPath } from "../utils/paths.js";
import type { BuddyCliConfig } from "./schema.js";

const defaultCliConfig: BuddyCliConfig = {
  serverUrl: localWebsocketUrl
};

async function readTrimmedFile(filePath: string): Promise<string | null> {
  try {
    const value = (await fs.readFile(filePath, "utf8")).trim();
    return value || null;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  return null;
}

export async function ensureCliHome(): Promise<void> {
  await fs.mkdir(buddyHome, { recursive: true });
  await fs.mkdir(cliHome, { recursive: true });
}

export async function loadCliConfig(): Promise<BuddyCliConfig> {
  await ensureCliHome();

  try {
    const raw = await fs.readFile(cliConfigPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BuddyCliConfig>;
    return {
      serverUrl: typeof parsed.serverUrl === "string" && parsed.serverUrl.trim() ? parsed.serverUrl.trim() : defaultCliConfig.serverUrl
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  await saveCliConfig(defaultCliConfig);
  return defaultCliConfig;
}

export async function saveCliConfig(config: BuddyCliConfig): Promise<void> {
  await ensureCliHome();
  await fs.writeFile(cliConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function isDefaultLocalServerUrl(serverUrl: string): boolean {
  return serverUrl === defaultCliConfig.serverUrl;
}

export async function loadCliAuthKey(): Promise<string | null> {
  await ensureCliHome();
  return await readTrimmedFile(cliKeyPath);
}

export async function saveCliAuthKey(key: string): Promise<void> {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new Error("The auth key cannot be empty.");
  }

  await ensureCliHome();
  await fs.writeFile(cliKeyPath, `${trimmedKey}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

export async function ensureCliAuthKey(serverUrl: string): Promise<string> {
  const existingKey = await loadCliAuthKey();
  if (existingKey) {
    return existingKey;
  }

  const localServerKey = isDefaultLocalServerUrl(serverUrl) ? await loadServerSecretToken() : null;
  if (!input.isTTY || !output.isTTY) {
    throw new Error(`The CLI auth key is missing. Save it to ${cliKeyPath} and try again.`);
  }

  const rl = readline.createInterface({ input, output });
  try {
    const prompt = localServerKey
      ? `Enter the buddy server auth key.\nPress Enter to use the local server key from ${serverSecretTokenPath}.\n> `
      : "Enter the buddy server auth key.\n> ";
    const answer = (await rl.question(prompt)).trim();
    const authKey = answer || localServerKey || "";

    if (!authKey) {
      throw new Error("A buddy server auth key is required to continue.");
    }

    await saveCliAuthKey(authKey);
    return authKey;
  } finally {
    rl.close();
  }
}

export async function loadCliSocketConnection(): Promise<{ serverUrl: string; authKey: string }> {
  const config = await loadCliConfig();
  return {
    serverUrl: config.serverUrl,
    authKey: await ensureCliAuthKey(config.serverUrl)
  };
}
