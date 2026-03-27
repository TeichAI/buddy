import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { ChatCompletionContentPartText, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { conversationsPath } from "../utils/paths.js";
import { ensureBuddyHome } from "../config/store.js";

export interface PersistedConversation {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ChatCompletionMessageParam[];
}

function conversationFilePath(id: string): string {
  return `${conversationsPath}/${id}.json`;
}

async function ensureConversationsDir(): Promise<void> {
  await ensureBuddyHome();
  await fs.mkdir(conversationsPath, { recursive: true });
}

function contentToText(content: ChatCompletionMessageParam["content"] | null | undefined): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part.type === "text") {
        return (part as ChatCompletionContentPartText).text;
      }

      return "";
    })
    .join("")
    .trim();
}

function truncateText(value: string, maxLength = 48): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function deriveConversationName(messages: ChatCompletionMessageParam[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const text = contentToText(message.content);
    if (text) {
      return truncateText(text);
    }
  }

  return null;
}

function normalizeConversation(input: PersistedConversation): PersistedConversation {
  const name = deriveConversationName(input.messages) ?? input.name ?? null;

  return {
    id: input.id,
    name,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    messages: input.messages
  };
}

export function conversationDisplayName(conversation: Pick<PersistedConversation, "name">): string {
  return conversation.name || "New chat";
}

export async function createConversation(): Promise<PersistedConversation> {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: null,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

export async function saveConversation(conversation: PersistedConversation): Promise<PersistedConversation> {
  await ensureConversationsDir();

  const normalized = normalizeConversation({
    ...conversation,
    updatedAt: new Date().toISOString()
  });

  await fs.writeFile(conversationFilePath(normalized.id), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function loadConversation(id: string): Promise<PersistedConversation> {
  await ensureConversationsDir();
  const raw = await fs.readFile(conversationFilePath(id), "utf8");
  return normalizeConversation(JSON.parse(raw) as PersistedConversation);
}

export async function deleteConversation(id: string): Promise<void> {
  await ensureConversationsDir();
  await fs.rm(conversationFilePath(id), { force: true });
}

export async function listConversations(): Promise<PersistedConversation[]> {
  await ensureConversationsDir();

  const entries = await fs.readdir(conversationsPath, { withFileTypes: true });
  const conversations = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const raw = await fs.readFile(`${conversationsPath}/${entry.name}`, "utf8");
        return normalizeConversation(JSON.parse(raw) as PersistedConversation);
      })
  );

  return conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadLatestConversation(): Promise<PersistedConversation | null> {
  const conversations = await listConversations();
  return conversations[0] ?? null;
}
