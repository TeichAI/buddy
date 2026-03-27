import type { BuddyConfig, ProviderPresetId } from "./schema.js";

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export const providerPresets: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1"
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    defaultModel: ""
  }
];

export const defaultConfig: BuddyConfig = {
  providers: {
    preset: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4.1"
  },
  personalization: {
    userName: "",
    botName: "buddy",
    systemInstructions: ""
  },
  channels: {
    discord: {
      enabled: false,
      botToken: "",
      applicationId: "",
      guildId: ""
    }
  },
  restrictions: {
    blockedDirectories: [],
    accessLevel: "supervised"
  }
};
