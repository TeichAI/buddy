import fs from "node:fs/promises";
import crypto from "node:crypto";
import { buddyHome, configPath, secretTokenPath, workspacePath } from "../utils/paths.js";
import { defaultConfig } from "./defaults.js";
import type { BuddyConfig } from "./schema.js";

function mergeConfig(input: Partial<BuddyConfig> | undefined): BuddyConfig {
  return {
    providers: {
      ...defaultConfig.providers,
      ...input?.providers
    },
    personalization: {
      ...defaultConfig.personalization,
      ...input?.personalization
    },
    channels: {
      discord: {
        ...defaultConfig.channels.discord,
        ...input?.channels?.discord,
        allowedUsernames:
          input?.channels?.discord?.allowedUsernames ?? defaultConfig.channels.discord.allowedUsernames
      }
    },
    restrictions: {
      ...defaultConfig.restrictions,
      ...input?.restrictions,
      blockedDirectories: input?.restrictions?.blockedDirectories ?? defaultConfig.restrictions.blockedDirectories
    }
  };
}

export async function ensureBuddyHome(): Promise<void> {
  await fs.mkdir(buddyHome, { recursive: true });
  await fs.mkdir(workspacePath, { recursive: true });
}

export async function ensureSecretToken(): Promise<string> {
  await ensureBuddyHome();

  try {
    const token = (await fs.readFile(secretTokenPath, "utf8")).trim();
    if (token) {
      return token;
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(secretTokenPath, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return token;
}

export async function loadSecretToken(): Promise<string> {
  return ensureSecretToken();
}

export async function loadConfig(): Promise<BuddyConfig> {
  await ensureBuddyHome();

  try {
    const raw = await fs.readFile(configPath, "utf8");
    return mergeConfig(JSON.parse(raw) as Partial<BuddyConfig>);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  await saveConfig(defaultConfig);
  return defaultConfig;
}

export async function saveConfig(config: BuddyConfig): Promise<void> {
  await ensureBuddyHome();
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
