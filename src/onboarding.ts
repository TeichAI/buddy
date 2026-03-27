import { providerPresets } from "./config/defaults.js";
import type { BuddyConfig, ProviderPresetId } from "./config/schema.js";
import { runOnboardingTui } from "./tui/onboarding-app.js";

export type OnboardingServerMode = "local" | "remote";

export interface OnboardingServerDraft {
  mode: OnboardingServerMode;
  serverUrl: string;
  authKey: string;
  localServerKeyFound: boolean;
}

export interface OnboardingReadiness {
  ready: boolean;
  missing: string[];
  recommended: string[];
}

export interface ServerOnboardingReadiness {
  ready: boolean;
  missing: string[];
  notes: string[];
}

function getProviderPreset(presetId: ProviderPresetId) {
  return providerPresets.find((preset) => preset.id === presetId) ?? providerPresets[0];
}

export function applyProviderPreset(config: BuddyConfig, presetId: ProviderPresetId): BuddyConfig {
  const nextPreset = getProviderPreset(presetId);
  const previousPreset = getProviderPreset(config.providers.preset);
  const hasCustomModel =
    Boolean(config.providers.model) && config.providers.model !== previousPreset.defaultModel;

  return {
    ...config,
    providers: {
      ...config.providers,
      preset: nextPreset.id,
      label: nextPreset.label,
      baseUrl:
        nextPreset.id === "custom"
          ? config.providers.preset === "custom"
            ? config.providers.baseUrl
            : ""
          : nextPreset.baseUrl,
      model: hasCustomModel ? config.providers.model : nextPreset.defaultModel
    }
  };
}

export function setProviderBaseUrl(config: BuddyConfig, baseUrl: string): BuddyConfig {
  const trimmedBaseUrl = baseUrl.trim();
  const preset = getProviderPreset(config.providers.preset);

  if (preset.id !== "custom" && trimmedBaseUrl && trimmedBaseUrl !== preset.baseUrl) {
    return {
      ...config,
      providers: {
        ...config.providers,
        preset: "custom",
        label: "Custom",
        baseUrl: trimmedBaseUrl
      }
    };
  }

  return {
    ...config,
    providers: {
      ...config.providers,
      baseUrl: trimmedBaseUrl
    }
  };
}

export function getServerOnboardingReadiness(server: OnboardingServerDraft): ServerOnboardingReadiness {
  const missing: string[] = [];
  const notes: string[] = [];

  if (server.mode === "remote") {
    if (!server.serverUrl.trim()) {
      missing.push("remote server URL");
    }

    if (!server.authKey.trim()) {
      missing.push("remote auth key");
    }
  } else if (server.localServerKeyFound) {
    notes.push("local server key found");
  } else {
    notes.push("local server key not found yet");
  }

  return {
    ready: missing.length === 0,
    missing,
    notes
  };
}

export function getOnboardingReadiness(config: BuddyConfig): OnboardingReadiness {
  const missing: string[] = [];
  const recommended: string[] = [];

  if (!config.providers.baseUrl.trim()) {
    missing.push("provider base URL");
  }

  if (!config.providers.apiKey.trim()) {
    missing.push("API key");
  }

  if (!config.providers.model.trim()) {
    missing.push("model");
  }

  if (!config.personalization.userName.trim()) {
    recommended.push("your name");
  }

  return {
    ready: missing.length === 0,
    missing,
    recommended
  };
}

export function serverOnboardingSummary(server: OnboardingServerDraft): string {
  const readiness = getServerOnboardingReadiness(server);

  if (server.mode === "local") {
    return server.localServerKeyFound ? "local / key detected" : "local / default host";
  }

  return readiness.ready ? "remote / configured" : "remote / setup incomplete";
}

export function providerOnboardingSummary(config: BuddyConfig): string {
  const readiness = getOnboardingReadiness(config);
  if (readiness.missing.some((item) => item === "provider base URL" || item === "API key" || item === "model")) {
    return `${config.providers.label} / setup incomplete`;
  }

  return `${config.providers.label} / ${config.providers.model}`;
}

export function personalizationOnboardingSummary(config: BuddyConfig): string {
  const userName = config.personalization.userName.trim() || "you";
  const botName = config.personalization.botName.trim() || "buddy";
  return `${botName} talking to ${userName}`;
}

export function safetyOnboardingSummary(config: BuddyConfig): string {
  return `${config.restrictions.accessLevel} / web ${config.tools.webSearch.enabled ? "on" : "off"}`;
}

export function finishOnboardingSummary(config: BuddyConfig): string {
  const readiness = getOnboardingReadiness(config);
  if (readiness.ready) {
    return readiness.recommended.length === 0 ? "ready to save" : `ready / optional: ${readiness.recommended.join(", ")}`;
  }

  return `missing ${readiness.missing.join(", ")}`;
}

export async function runOnboarding(): Promise<void> {
  await runOnboardingTui();
}
