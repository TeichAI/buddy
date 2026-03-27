import crypto from "node:crypto";
import {
  createConversation,
  listConversations,
  loadConversation,
  loadLatestConversation,
  type PersistedConversation
} from "../conversations/store.js";
import { getDiscordContextState, setDiscordContextState } from "../current/store.js";

export async function listDiscordConversations(): Promise<PersistedConversation[]> {
  return await listConversations({ includeEmpty: false });
}

export async function setCurrentDiscordConversation(contextKey: string, conversationId: string): Promise<void> {
  await setDiscordContextState(contextKey, {
    currentConversationId: conversationId,
    pendingConversationId: null
  });
}

export async function preparePendingDiscordConversation(contextKey: string): Promise<string> {
  const pendingConversationId = crypto.randomUUID();
  await setDiscordContextState(contextKey, {
    currentConversationId: null,
    pendingConversationId
  });
  return pendingConversationId;
}

export async function getActiveDiscordConversationId(contextKey: string): Promise<string | null> {
  const context = await getDiscordContextState(contextKey);

  if (context.currentConversationId) {
    try {
      await loadConversation(context.currentConversationId);
      return context.currentConversationId;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (context.pendingConversationId) {
    return context.pendingConversationId;
  }

  const latest = await loadLatestConversation({ includeEmpty: false });
  return latest?.id ?? null;
}

export async function getCurrentDiscordConversation(contextKey: string): Promise<PersistedConversation | null> {
  const context = await getDiscordContextState(contextKey);

  if (context.currentConversationId) {
    try {
      return await loadConversation(context.currentConversationId);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (context.pendingConversationId) {
    return null;
  }

  const latest = await loadLatestConversation({ includeEmpty: false });
  if (latest) {
    await setCurrentDiscordConversation(contextKey, latest.id);
    return latest;
  }

  return null;
}

export async function createOrLoadDiscordConversationForTurn(contextKey: string): Promise<PersistedConversation> {
  const current = await getCurrentDiscordConversation(contextKey);
  if (current) {
    return current;
  }

  const context = await getDiscordContextState(contextKey);
  const conversation = await createConversation();

  if (context.pendingConversationId) {
    return {
      ...conversation,
      id: context.pendingConversationId
    };
  }

  const pendingConversationId = crypto.randomUUID();
  await setDiscordContextState(contextKey, {
    currentConversationId: null,
    pendingConversationId
  });

  return {
    ...conversation,
    id: pendingConversationId
  };
}
