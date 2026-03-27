import fs from "node:fs/promises";
import { ensureBuddyHome } from "../config/store.js";
import { currentPath, discordContextsPath } from "../utils/paths.js";

export interface DiscordConversationContextState {
  currentConversationId: string | null;
  pendingConversationId: string | null;
}

export interface CurrentState {
  cli: {
    currentConversationId: string | null;
  };
  discord: {
    contexts: Record<string, DiscordConversationContextState>;
  };
}

const defaultState: CurrentState = {
  cli: {
    currentConversationId: null
  },
  discord: {
    contexts: {}
  }
};

async function migrateLegacyDiscordState(): Promise<CurrentState | null> {
  try {
    const raw = await fs.readFile(discordContextsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      contexts?: Record<string, DiscordConversationContextState>;
    };

    return {
      ...defaultState,
      discord: {
        contexts: parsed.contexts ?? {}
      }
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  return null;
}

export async function loadCurrentState(): Promise<CurrentState> {
  await ensureBuddyHome();

  try {
    const raw = await fs.readFile(currentPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CurrentState>;
    return {
      cli: {
        currentConversationId: parsed.cli?.currentConversationId ?? defaultState.cli.currentConversationId
      },
      discord: {
        contexts: parsed.discord?.contexts ?? defaultState.discord.contexts
      }
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  const migrated = await migrateLegacyDiscordState();
  const state = migrated ?? defaultState;
  await saveCurrentState(state);
  return state;
}

export async function saveCurrentState(state: CurrentState): Promise<void> {
  await ensureBuddyHome();
  await fs.writeFile(currentPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function getCliCurrentConversationId(): Promise<string | null> {
  const state = await loadCurrentState();
  return state.cli.currentConversationId;
}

export async function setCliCurrentConversationId(conversationId: string | null): Promise<void> {
  const state = await loadCurrentState();
  state.cli.currentConversationId = conversationId;
  await saveCurrentState(state);
}

export async function getDiscordContextState(contextKey: string): Promise<DiscordConversationContextState> {
  const state = await loadCurrentState();
  return (
    state.discord.contexts[contextKey] ?? {
      currentConversationId: null,
      pendingConversationId: null
    }
  );
}

export async function setDiscordContextState(
  contextKey: string,
  contextState: DiscordConversationContextState
): Promise<void> {
  const state = await loadCurrentState();
  state.discord.contexts[contextKey] = contextState;
  await saveCurrentState(state);
}
