export type ProviderPresetId = "openai" | "openrouter" | "custom";
export type AccessLevel = "full" | "supervised";

export interface ProviderConfig {
  preset: ProviderPresetId;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface PersonalizationConfig {
  userName: string;
  botName: string;
  systemInstructions: string;
}

export interface DiscordChannelConfig {
  enabled: boolean;
  botToken: string;
  applicationId: string;
  allowedUsernames: string[];
}

export interface ChannelsConfig {
  discord: DiscordChannelConfig;
}

export interface RestrictionsConfig {
  blockedDirectories: string[];
  accessLevel: AccessLevel;
}

export interface BuddyConfig {
  providers: ProviderConfig;
  personalization: PersonalizationConfig;
  channels: ChannelsConfig;
  restrictions: RestrictionsConfig;
}
