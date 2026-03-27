import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { BuddyConfig } from "../config/schema.js";

export async function sendChatMessage(
  config: BuddyConfig,
  messages: ChatCompletionMessageParam[]
): Promise<string> {
  if (!config.providers.baseUrl || !config.providers.apiKey || !config.providers.model) {
    throw new Error("Provider is not fully configured. Run `buddy config` and complete Providers.");
  }

  const client = new OpenAI({
    apiKey: config.providers.apiKey,
    baseURL: config.providers.baseUrl
  });

  const response = await client.chat.completions.create({
    model: config.providers.model,
    messages,
    temperature: 0.7
  });

  return response.choices[0]?.message?.content?.trim() || "(No response)";
}
