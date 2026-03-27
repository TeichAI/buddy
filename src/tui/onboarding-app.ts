import type { Component, SelectItem, SettingItem } from "@mariozechner/pi-tui";
import { ProcessTerminal, SelectList, SettingsList, TUI, Text } from "@mariozechner/pi-tui";
import {
  clearCliAuthKey,
  loadCliAuthKey,
  loadCliConfig,
  saveCliAuthKey,
  saveCliConfig,
  isDefaultLocalServerUrl
} from "../cli-config/store.js";
import type { BuddyCliConfig } from "../cli-config/schema.js";
import { providerPresets } from "../config/defaults.js";
import { loadConfig, loadExistingServerSecretToken, saveConfig } from "../config/store.js";
import type { BuddyConfig } from "../config/schema.js";
import {
  applyProviderPreset,
  getOnboardingReadiness,
  getServerOnboardingReadiness,
  serverOnboardingSummary,
  setProviderBaseUrl,
  type OnboardingServerDraft,
  type OnboardingServerMode
} from "../onboarding.js";
import { localWebsocketUrl, serverSecretTokenPath } from "../utils/paths.js";
import { Frame } from "./components/frame.js";
import { SelectDialog } from "./components/select-dialog.js";
import { TextEditorDialog } from "./components/text-editor-dialog.js";
import { settingsTheme, selectTheme, theme } from "./theme.js";

type OnboardingStepId = "server" | "provider" | "personalization" | "safety" | "review";

const onboardingSteps: OnboardingStepId[] = ["server", "provider", "personalization", "safety", "review"];

class SettingsPage implements Component {
  constructor(
    private readonly title: Text,
    private readonly subtitle: Text,
    private readonly list: SettingsList
  ) {}

  invalidate(): void {
    this.title.invalidate();
    this.subtitle.invalidate();
    this.list.invalidate();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    return [
      ...this.title.render(width),
      ...this.subtitle.render(width),
      "",
      ...this.list.render(width)
    ];
  }
}

class ReviewContent implements Component {
  constructor(
    private readonly summaryLines: () => string[],
    private readonly actions: SelectList
  ) {}

  invalidate(): void {
    this.actions.invalidate();
  }

  handleInput(data: string): void {
    this.actions.handleInput(data);
  }

  render(width: number): string[] {
    return [...this.summaryLines(), "", ...this.actions.render(width)];
  }
}

class OnboardingScreen implements Component {
  constructor(
    private readonly getPage: () => Component,
    private readonly statusLine: Text
  ) {}

  invalidate(): void {
    this.getPage().invalidate();
    this.statusLine.invalidate();
  }

  handleInput(data: string): void {
    this.getPage().handleInput?.(data);
  }

  render(width: number): string[] {
    return [...this.getPage().render(width), "", ...this.statusLine.render(width)];
  }
}

function createPage(params: { title: string; subtitle: string; list: SettingsList }): SettingsPage {
  return new SettingsPage(
    new Text(theme.title(params.title), 0, 0),
    new Text(theme.muted(params.subtitle), 0, 0),
    params.list
  );
}

function formatConfigValue(value: string, fallback = "unset"): string {
  return value.trim() || fallback;
}

function createProviderItems(): SelectItem[] {
  return providerPresets.map((preset) => ({
    value: preset.id,
    label: preset.label,
    description: preset.baseUrl || "Bring your own OpenAI-compatible endpoint"
  }));
}

function buildServerReviewLine(serverDraft: OnboardingServerDraft): string {
  if (serverDraft.mode === "local") {
    return `Server: local (${localWebsocketUrl})`;
  }

  return `Server: remote (${formatConfigValue(serverDraft.serverUrl)})`;
}

function buildReviewSummary(serverDraft: OnboardingServerDraft, config: BuddyConfig): string[] {
  const serverReadiness = getServerOnboardingReadiness(serverDraft);
  const configReadiness = getOnboardingReadiness(config);
  const lines = [
    theme.heading("Draft setup"),
    theme.text(buildServerReviewLine(serverDraft)),
    theme.text(
      serverDraft.mode === "local"
        ? `Server auth: ${serverDraft.localServerKeyFound ? "using local key from standard path" : "will use standard local key path when available"}`
        : `Server auth: ${serverDraft.authKey.trim() ? "configured" : "not set"}`
    ),
    theme.text(`Provider: ${config.providers.label}`),
    theme.text(`Base URL: ${formatConfigValue(config.providers.baseUrl)}`),
    theme.text(`Model: ${formatConfigValue(config.providers.model)}`),
    theme.text(`API key: ${config.providers.apiKey ? "configured" : "not set"}`),
    theme.text(`You: ${formatConfigValue(config.personalization.userName, "you")}`),
    theme.text(`Assistant: ${formatConfigValue(config.personalization.botName, "buddy")}`),
    theme.text(`Access: ${config.restrictions.accessLevel}`),
    theme.text(`Web search: ${config.tools.webSearch.enabled ? "enabled" : "disabled"}`)
  ];

  const blocking = [...serverReadiness.missing, ...configReadiness.missing];

  if (blocking.length === 0) {
    lines.push("");
    lines.push(theme.success("Required setup is complete."));
    if (configReadiness.recommended.length > 0) {
      lines.push(theme.muted(`Optional polish: ${configReadiness.recommended.join(", ")}.`));
    }
    if (serverReadiness.notes.length > 0) {
      lines.push(theme.muted(`Server note: ${serverReadiness.notes.join(", ")}.`));
    }
  } else {
    lines.push("");
    lines.push(theme.error(`Still missing: ${blocking.join(", ")}.`));
  }

  return lines;
}

function buildStatusText(step: OnboardingStepId, serverDraft: OnboardingServerDraft, config: BuddyConfig): string {
  const stepIndex = onboardingSteps.indexOf(step) + 1;
  const prefix = theme.muted(`Step ${stepIndex} of ${onboardingSteps.length}`);
  const serverReadiness = getServerOnboardingReadiness(serverDraft);
  const configReadiness = getOnboardingReadiness(config);

  if (step === "server") {
    if (serverDraft.mode === "local") {
      const detail = serverDraft.localServerKeyFound
        ? theme.success("Local server selected. The standard local auth key was found.")
        : theme.muted(`Local server selected. Buddy will use ${serverSecretTokenPath} when it exists.`);
      return `${prefix}  ·  ${detail}`;
    }

    if (!serverReadiness.ready) {
      return `${prefix}  ·  ${theme.error(`Still missing ${serverReadiness.missing.join(", ")}.`)}`;
    }

    return `${prefix}  ·  ${theme.success("Remote server connection is configured.")}`;
  }

  if (step !== "review") {
    const detail = configReadiness.ready
      ? configReadiness.recommended.length > 0
        ? theme.muted(`Required setup is done. Optional: ${configReadiness.recommended.join(", ")}.`)
        : theme.success("Required setup is done.")
      : theme.error(`Still missing ${configReadiness.missing.join(", ")}.`);
    return `${prefix}  ·  ${detail}`;
  }

  const blocking = [...serverReadiness.missing, ...configReadiness.missing];
  if (blocking.length > 0) {
    return `${prefix}  ·  ${theme.error(`Save is blocked until you add ${blocking.join(", ")}.`)}`;
  }

  if (configReadiness.recommended.length > 0) {
    return `${prefix}  ·  ${theme.muted(`Ready to save. Optional polish: ${configReadiness.recommended.join(", ")}.`)}`;
  }

  return `${prefix}  ·  ${theme.success("Ready to save.")}`;
}

export async function runOnboardingTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`buddy onboard` requires an interactive terminal.");
  }

  const [draftConfigLoaded, draftCliConfig, draftCliAuthKey, localServerKey] = await Promise.all([
    loadConfig(),
    loadCliConfig(),
    loadCliAuthKey(),
    loadExistingServerSecretToken()
  ]);

  let draftConfig: BuddyConfig = draftConfigLoaded;
  let draftServer: OnboardingServerDraft = {
    mode: isDefaultLocalServerUrl(draftCliConfig.serverUrl) ? "local" : "remote",
    serverUrl: isDefaultLocalServerUrl(draftCliConfig.serverUrl) ? localWebsocketUrl : draftCliConfig.serverUrl,
    authKey: isDefaultLocalServerUrl(draftCliConfig.serverUrl) ? "" : draftCliAuthKey ?? "",
    localServerKeyFound: Boolean(localServerKey)
  };
  let currentStep: OnboardingStepId = "server";
  let activePage: Component;
  let exiting = false;

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, true);
  const statusLine = new Text("", 0, 0);

  const requestExit = () => {
    if (exiting) {
      return;
    }

    exiting = true;
    terminal.setTitle("buddy onboard");
    tui.stop();
  };

  const goToStep = (step: OnboardingStepId) => {
    currentStep = step;
    activePage = buildStepPage(step);
    statusLine.setText(buildStatusText(step, draftServer, draftConfig));
    tui.requestRender();
  };

  const goToNextStep = () => {
    const stepIndex = onboardingSteps.indexOf(currentStep);
    const nextStep = onboardingSteps[Math.min(stepIndex + 1, onboardingSteps.length - 1)];
    goToStep(nextStep);
  };

  const updateStepStatus = () => {
    statusLine.setText(buildStatusText(currentStep, draftServer, draftConfig));
    tui.requestRender();
  };

  const buildServerPage = (): Component => {
    const list = new SettingsList(
      [
        {
          id: "mode",
          label: "Buddy Server",
          description: "Choose whether Buddy connects to a local or remote server",
          currentValue: draftServer.mode === "local" ? "Local" : "Remote",
          submenu: (_value, choose) =>
            new SelectDialog({
              title: "Buddy Server",
              subtitle: "Local uses the standard Buddy websocket address. Remote lets you enter your own URL and key.",
              items: [
                {
                  value: "local",
                  label: "Local",
                  description: `${localWebsocketUrl} with the standard local token path`
                },
                {
                  value: "remote",
                  label: "Remote",
                  description: "Early alpha: remote support is not 100% yet. Bring your own Buddy server URL and auth key."
                }
              ],
              onSelect: (item) => choose(item.value),
              onCancel: () => choose()
            })
        },
        {
          id: "serverUrl",
          label: "Server URL",
          description:
            draftServer.mode === "local"
              ? "Fixed to Buddy's default local websocket host and port"
              : "Required for remote Buddy servers",
          currentValue: draftServer.mode === "local" ? localWebsocketUrl : formatConfigValue(draftServer.serverUrl),
          submenu:
            draftServer.mode === "remote"
              ? (value, choose) =>
                  new TextEditorDialog({
                    tui,
                    title: "Remote Server URL",
                    subtitle: "Example: ws://192.168.1.10:4317 or wss://buddy.example.com",
                    initialValue: value === "unset" ? "" : value,
                    onSave: (newValue) => choose(newValue.trim()),
                    onCancel: () => choose()
                  })
              : undefined
        },
        {
          id: "authKey",
          label: "Auth Key",
          description:
            draftServer.mode === "local"
              ? `Buddy checks ${serverSecretTokenPath}`
              : "Required for remote Buddy servers",
          currentValue:
            draftServer.mode === "local"
              ? draftServer.localServerKeyFound
                ? "found in standard path"
                : "not found yet"
              : draftServer.authKey.trim()
                ? "configured"
                : "not set",
          submenu:
            draftServer.mode === "remote"
              ? (_value, choose) =>
                  new TextEditorDialog({
                    tui,
                    title: "Remote Auth Key",
                    subtitle: "The shared auth key for the remote Buddy server",
                    initialValue: draftServer.authKey,
                    onSave: (newValue) => choose(newValue.trim()),
                    onCancel: () => choose()
                  })
              : undefined
        }
      ] satisfies SettingItem[],
      10,
      settingsTheme,
      (id, newValue) => {
        if (id === "mode") {
          const nextMode = newValue as OnboardingServerMode;
          draftServer = {
            ...draftServer,
            mode: nextMode,
            serverUrl: nextMode === "local" ? localWebsocketUrl : draftServer.serverUrl === localWebsocketUrl ? "" : draftServer.serverUrl
          };
          list.updateValue("mode", nextMode === "local" ? "Local" : "Remote");
          list.updateValue("serverUrl", nextMode === "local" ? localWebsocketUrl : formatConfigValue(draftServer.serverUrl));
          list.updateValue(
            "authKey",
            nextMode === "local"
              ? draftServer.localServerKeyFound
                ? "found in standard path"
                : "not found yet"
              : draftServer.authKey.trim()
                ? "configured"
                : "not set"
          );
          goToStep("server");
          return;
        }

        if (id === "serverUrl") {
          draftServer = {
            ...draftServer,
            serverUrl: newValue
          };
          list.updateValue("serverUrl", formatConfigValue(newValue));
          updateStepStatus();
          return;
        }

        if (id === "authKey") {
          draftServer = {
            ...draftServer,
            authKey: newValue
          };
          list.updateValue("authKey", newValue.trim() ? "configured" : "not set");
          updateStepStatus();
        }
      },
      () => goToNextStep(),
      { enableSearch: true }
    );

    return createPage({
      title: "Step 1  Buddy Server",
      subtitle: "Choose local or remote first. Esc continues to Provider Setup.",
      list
    });
  };

  const buildProviderPage = (): Component => {
    const list = new SettingsList(
      [
        {
          id: "preset",
          label: "Preset",
          description: "Choose the upstream API profile",
          currentValue: draftConfig.providers.label,
          submenu: (_value, choose) =>
            new SelectDialog({
              title: "Provider Preset",
              subtitle: "OpenAI and OpenRouter are prefilled. Custom lets you bring any compatible endpoint.",
              items: createProviderItems(),
              onSelect: (item) => choose(item.value),
              onCancel: () => choose()
            })
        },
        {
          id: "baseUrl",
          label: "Base URL",
          description:
            draftConfig.providers.preset === "custom"
              ? "Required for custom providers"
              : "Preset-managed. Editing it switches the provider to Custom.",
          currentValue: formatConfigValue(draftConfig.providers.baseUrl),
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Provider Base URL",
              subtitle: "OpenAI-compatible API root",
              initialValue: value === "unset" ? "" : value,
              onSave: (newValue) => choose(newValue),
              onCancel: () => choose()
            })
        },
        {
          id: "apiKey",
          label: "API Key",
          description: "Stored in plain text on this machine",
          currentValue: draftConfig.providers.apiKey ? "configured" : "not set",
          submenu: (_value, choose) =>
            new TextEditorDialog({
              tui,
              title: "API Key",
              subtitle: "Buddy needs this before chat can work",
              initialValue: draftConfig.providers.apiKey,
              onSave: (newValue) => choose(newValue.trim()),
              onCancel: () => choose()
            })
        },
        {
          id: "model",
          label: "Model",
          description: "Example: gpt-4.1 or openai/gpt-4.1",
          currentValue: formatConfigValue(draftConfig.providers.model),
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Model",
              subtitle: "The model name Buddy will send to the provider",
              initialValue: value === "unset" ? "" : value,
              onSave: (newValue) => choose(newValue.trim()),
              onCancel: () => choose()
            })
        }
      ] satisfies SettingItem[],
      12,
      settingsTheme,
      (id, newValue) => {
        if (id === "preset") {
          draftConfig = applyProviderPreset(draftConfig, newValue as BuddyConfig["providers"]["preset"]);
          list.updateValue("preset", draftConfig.providers.label);
          list.updateValue("baseUrl", formatConfigValue(draftConfig.providers.baseUrl));
          list.updateValue("model", formatConfigValue(draftConfig.providers.model));
          updateStepStatus();
          return;
        }

        if (id === "baseUrl") {
          draftConfig = setProviderBaseUrl(draftConfig, newValue);
          list.updateValue("preset", draftConfig.providers.label);
          list.updateValue("baseUrl", formatConfigValue(newValue));
          updateStepStatus();
          return;
        }

        if (id === "apiKey" || id === "model") {
          draftConfig = {
            ...draftConfig,
            providers: {
              ...draftConfig.providers,
              [id]: newValue
            }
          };
          list.updateValue(id, id === "apiKey" ? (newValue ? "configured" : "not set") : formatConfigValue(newValue));
          updateStepStatus();
        }
      },
      () => goToNextStep(),
      { enableSearch: true }
    );

    return createPage({
      title: "Step 2  Provider Setup",
      subtitle: "Enter edits a field. Esc continues to Personalization.",
      list
    });
  };

  const buildPersonalizationPage = (): Component => {
    const list = new SettingsList(
      [
        {
          id: "userName",
          label: "Your Name",
          description: "Optional, but it makes replies feel more personal",
          currentValue: formatConfigValue(draftConfig.personalization.userName),
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Your Name",
              subtitle: "This is used in chat and the system prompt",
              initialValue: value === "unset" ? "" : value,
              onSave: (newValue) => choose(newValue.trim()),
              onCancel: () => choose()
            })
        },
        {
          id: "botName",
          label: "Assistant Name",
          description: "Defaults to buddy",
          currentValue: formatConfigValue(draftConfig.personalization.botName, "buddy"),
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Assistant Name",
              subtitle: "What Buddy should call itself in chat",
              initialValue: value === "unset" ? "" : value,
              onSave: (newValue) => choose(newValue.trim() || "buddy"),
              onCancel: () => choose()
            })
        }
      ] satisfies SettingItem[],
      10,
      settingsTheme,
      (id, newValue) => {
        if (id !== "userName" && id !== "botName") {
          return;
        }

        draftConfig = {
          ...draftConfig,
          personalization: {
            ...draftConfig.personalization,
            [id]: id === "botName" ? newValue || "buddy" : newValue
          }
        };
        list.updateValue(id, formatConfigValue(newValue, id === "botName" ? "buddy" : "unset"));
        updateStepStatus();
      },
      () => goToNextStep(),
      { enableSearch: true }
    );

    return createPage({
      title: "Step 3  Personalization",
      subtitle: "Give Buddy names for you and the assistant. Esc continues to Safety & Tools.",
      list
    });
  };

  const buildSafetyPage = (): Component => {
    const list = new SettingsList(
      [
        {
          id: "accessLevel",
          label: "Access Level",
          description: "Supervised asks before file access outside the workspace",
          currentValue: draftConfig.restrictions.accessLevel,
          submenu: (_value, choose) =>
            new SelectDialog({
              title: "Access Level",
              subtitle: "Supervised is the safer default for a fresh install.",
              items: [
                {
                  value: "supervised",
                  label: "Supervised",
                  description: "Require approval for file access outside the workspace"
                },
                {
                  value: "full",
                  label: "Full access",
                  description: "No approval prompts, except for blocked paths"
                }
              ],
              onSelect: (item) => choose(item.value),
              onCancel: () => choose()
            })
        },
        {
          id: "webSearch",
          label: "Web Search",
          description: "DuckDuckGo HTML search plus text extraction from the top 3 pages",
          currentValue: draftConfig.tools.webSearch.enabled ? "on" : "off",
          values: ["off", "on"]
        }
      ] satisfies SettingItem[],
      10,
      settingsTheme,
      (id, newValue) => {
        if (id === "accessLevel") {
          draftConfig = {
            ...draftConfig,
            restrictions: {
              ...draftConfig.restrictions,
              accessLevel: newValue as BuddyConfig["restrictions"]["accessLevel"]
            }
          };
          list.updateValue("accessLevel", newValue);
          updateStepStatus();
          return;
        }

        if (id === "webSearch") {
          draftConfig = {
            ...draftConfig,
            tools: {
              ...draftConfig.tools,
              webSearch: {
                ...draftConfig.tools.webSearch,
                enabled: newValue === "on"
              }
            }
          };
          list.updateValue("webSearch", newValue);
          updateStepStatus();
        }
      },
      () => goToNextStep(),
      { enableSearch: true }
    );

    return createPage({
      title: "Step 4  Safety & Tools",
      subtitle: "Choose safety defaults now. Esc continues to Review & Save.",
      list
    });
  };

  const buildReviewPage = (): Component => {
    const actions = new SelectList(
      [
        {
          value: "save",
          label: "Save setup",
          description: "Write this draft config and finish onboarding"
        },
        {
          value: "server",
          label: "Edit server",
          description: "Jump back to Step 1"
        },
        {
          value: "provider",
          label: "Edit provider",
          description: "Jump back to Step 2"
        },
        {
          value: "personalization",
          label: "Edit personalization",
          description: "Jump back to Step 3"
        },
        {
          value: "safety",
          label: "Edit safety",
          description: "Jump back to Step 4"
        }
      ],
      8,
      selectTheme
    );

    actions.onSelect = (item) => {
      if (item.value === "save") {
        const serverReadiness = getServerOnboardingReadiness(draftServer);
        const configReadiness = getOnboardingReadiness(draftConfig);
        const blocking = [...serverReadiness.missing, ...configReadiness.missing];

        if (blocking.length > 0) {
          statusLine.setText(theme.error(`Cannot save yet. Missing ${blocking.join(", ")}.`));
          tui.requestRender();
          return;
        }

        statusLine.setText(theme.muted("Saving Buddy setup..."));
        tui.requestRender();
        void (async () => {
          const nextCliConfig: BuddyCliConfig = {
            serverUrl: draftServer.mode === "local" ? localWebsocketUrl : draftServer.serverUrl.trim()
          };

          await saveCliConfig(nextCliConfig);

          if (draftServer.mode === "remote") {
            await saveCliAuthKey(draftServer.authKey.trim());
          } else {
            await clearCliAuthKey();
          }

          await saveConfig(draftConfig);
          statusLine.setText(theme.success("Setup saved. Run `buddy` to start chatting."));
          tui.requestRender();
          requestExit();
        })().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          statusLine.setText(theme.error(`Could not save setup: ${message}`));
          tui.requestRender();
        });
        return;
      }

      goToStep(item.value as OnboardingStepId);
    };

    actions.onCancel = () => goToStep("safety");

    return new Frame(
      "Step 5  Review & Save",
      new ReviewContent(() => buildReviewSummary(draftServer, draftConfig), actions),
      "Save here, or jump back to a specific step before writing anything to disk."
    );
  };

  const buildStepPage = (step: OnboardingStepId): Component => {
    if (step === "server") {
      return buildServerPage();
    }

    if (step === "provider") {
      return buildProviderPage();
    }

    if (step === "personalization") {
      return buildPersonalizationPage();
    }

    if (step === "safety") {
      return buildSafetyPage();
    }

    return buildReviewPage();
  };

  activePage = buildStepPage(currentStep);
  statusLine.setText(buildStatusText(currentStep, draftServer, draftConfig));

  const screen = new OnboardingScreen(() => activePage, statusLine);
  tui.addChild(screen);
  tui.setFocus(screen);
  terminal.setTitle("buddy onboard");

  await new Promise<void>((resolve) => {
    const sigintHandler = () => requestExit();
    const sigtermHandler = () => requestExit();

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    const originalStop = tui.stop.bind(tui);
    tui.stop = () => {
      originalStop();
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("SIGTERM", sigtermHandler);
      resolve();
    };

    tui.start();
  });
}
