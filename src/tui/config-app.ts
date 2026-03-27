import type { Component, SettingItem } from "@mariozechner/pi-tui";
import { Container, ProcessTerminal, SettingsList, TUI, Text } from "@mariozechner/pi-tui";
import type { BuddyConfig } from "../config/schema.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { SelectDialog } from "./components/select-dialog.js";
import { TextEditorDialog } from "./components/text-editor-dialog.js";
import { settingsTheme, theme } from "./theme.js";

function providersSummary(config: BuddyConfig): string {
  return `${config.providers.label} / ${config.providers.model || "unset"}`;
}

function personalizationSummary(config: BuddyConfig): string {
  return `${config.personalization.botName || "buddy"} talking to ${config.personalization.userName || "you"}`;
}

function channelsSummary(config: BuddyConfig): string {
  const allowed = config.channels.discord.allowedUsernames.length;
  return config.channels.discord.enabled
    ? `Discord enabled / ${allowed} allowed ${allowed === 1 ? "user" : "users"}`
    : "Discord disabled";
}

function restrictionsSummary(config: BuddyConfig): string {
  const blocked = config.restrictions.blockedDirectories.length;
  return `${config.restrictions.accessLevel} / ${blocked} blocked ${blocked === 1 ? "directory" : "directories"}`;
}

function toolsSummary(config: BuddyConfig): string {
  return `Web search ${config.tools.webSearch.enabled ? "enabled" : "disabled"}`;
}

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

function createPage(params: { title: string; subtitle: string; list: SettingsList }): SettingsPage {
  return new SettingsPage(
    new Text(theme.title(params.title), 0, 0),
    new Text(theme.muted(params.subtitle), 0, 0),
    params.list
  );
}

export async function runConfigTui(): Promise<void> {
  let config = await loadConfig();
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, true);
  const root = new Container();
  const statusLine = new Text("", 0, 0);

  let exiting = false;

  const requestExit = () => {
    if (exiting) {
      return;
    }
    exiting = true;
    terminal.setTitle("buddy config");
    tui.stop();
  };

  const persist = async (nextConfig: BuddyConfig): Promise<void> => {
    config = nextConfig;
    await saveConfig(nextConfig);
    rootList.updateValue("providers", providersSummary(nextConfig));
    rootList.updateValue("personalization", personalizationSummary(nextConfig));
    rootList.updateValue("channels", channelsSummary(nextConfig));
    rootList.updateValue("restrictions", restrictionsSummary(nextConfig));
    rootList.updateValue("tools", toolsSummary(nextConfig));
    statusLine.setText(theme.success("Saved to ~/.buddy/config.json"));
    tui.requestRender();
  };

  const buildProvidersPage = (done: (value?: string) => void): Component => {
    const list = new SettingsList(
      [
        {
          id: "preset",
          label: "Preset",
          description: "OpenAI-compatible provider preset",
          currentValue: config.providers.label,
          submenu: (_value, choose) =>
            new SelectDialog({
              title: "Provider Preset",
              subtitle: "Choose the upstream API profile",
              items: [
                { value: "openai", label: "OpenAI", description: "https://api.openai.com/v1" },
                { value: "openrouter", label: "OpenRouter", description: "https://openrouter.ai/api/v1" },
                { value: "custom", label: "Custom", description: "Bring your own compatible endpoint" }
              ],
              onSelect: (item) => choose(item.value),
              onCancel: () => choose()
            })
        },
        {
          id: "baseUrl",
          label: "Base URL",
          description: "Stored in ~/.buddy/config.json",
          currentValue: config.providers.baseUrl || "unset",
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
          description: "Warning: stored in plain text",
          currentValue: config.providers.apiKey ? "configured" : "not set",
          submenu: (_value, choose) =>
            new TextEditorDialog({
              tui,
              title: "API Key",
              subtitle: "Warning: stored in plain text in ~/.buddy/config.json",
              initialValue: config.providers.apiKey,
              onSave: (newValue) => {
                void persist({
                  ...config,
                  providers: {
                    ...config.providers,
                    apiKey: newValue
                  }
                });
                choose(newValue ? "configured" : "not set");
              },
              onCancel: () => choose()
            })
        },
        {
          id: "model",
          label: "Model",
          description: "Model name sent to the provider",
          currentValue: config.providers.model || "unset",
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Model",
              subtitle: "Example: gpt-4.1 or openai/gpt-4.1",
              initialValue: value === "unset" ? "" : value,
              onSave: (newValue) => choose(newValue),
              onCancel: () => choose()
            })
        }
      ],
      12,
      settingsTheme,
      (id, newValue) => {
        if (id === "preset") {
          const presetMap = {
            openai: {
              label: "OpenAI",
              baseUrl: "https://api.openai.com/v1",
              model: config.providers.model || "gpt-4.1"
            },
            openrouter: {
              label: "OpenRouter",
              baseUrl: "https://openrouter.ai/api/v1",
              model: config.providers.model || "openai/gpt-4.1"
            },
            custom: {
              label: "Custom",
              baseUrl: config.providers.baseUrl,
              model: config.providers.model
            }
          } as const;

          const preset = presetMap[newValue as keyof typeof presetMap];
          void persist({
            ...config,
            providers: {
              ...config.providers,
              preset: newValue as BuddyConfig["providers"]["preset"],
              label: preset.label,
              baseUrl: preset.baseUrl,
              model: preset.model
            }
          });
          list.updateValue("preset", preset.label);
          list.updateValue("baseUrl", preset.baseUrl || "unset");
          list.updateValue("model", preset.model || "unset");
          return;
        }

        if (id === "baseUrl" || id === "model") {
          void persist({
            ...config,
            providers: {
              ...config.providers,
              [id]: newValue
            }
          });
          list.updateValue(id, newValue || "unset");
        }
      },
      () => done(providersSummary(config)),
      { enableSearch: true }
    );

    return createPage({
      title: "Providers",
      subtitle: "Preset, base URL, API key, and model. Esc returns to sections.",
      list
    });
  };

  const buildPersonalizationPage = (done: (value?: string) => void): Component => {
    const list = new SettingsList(
      [
        {
          id: "userName",
          label: "Your Name",
          description: "Used to personalize chat and the system prompt",
          currentValue: config.personalization.userName || "unset",
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Your Name",
              subtitle: "Used to personalize chat and the system prompt",
              initialValue: value === "unset" ? "" : value,
              onSave: (newValue) => choose(newValue),
              onCancel: () => choose()
            })
        },
        {
          id: "botName",
          label: "Bot Name",
          description: "Defaults to buddy",
          currentValue: config.personalization.botName,
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Bot Name",
              subtitle: "This appears in chat and the system prompt",
              initialValue: value,
              onSave: (newValue) => choose(newValue || "buddy"),
              onCancel: () => choose()
            })
        },
        {
          id: "systemInstructions",
          label: "System Instructions",
          description: "Special behavior rules appended to the system message",
          currentValue: config.personalization.systemInstructions ? "configured" : "not set",
          submenu: (_value, choose) =>
            new TextEditorDialog({
              tui,
              title: "System Instructions",
              subtitle: "Plain text behavior and tone instructions",
              initialValue: config.personalization.systemInstructions,
              onSave: (newValue) => {
                void persist({
                  ...config,
                  personalization: {
                    ...config.personalization,
                    systemInstructions: newValue
                  }
                });
                choose(newValue ? "configured" : "not set");
              },
              onCancel: () => choose()
            })
        }
      ],
      12,
      settingsTheme,
      (id, newValue) => {
        if (id !== "userName" && id !== "botName") {
          return;
        }

        void persist({
          ...config,
          personalization: {
            ...config.personalization,
            [id]: id === "botName" ? newValue || "buddy" : newValue
          }
        });
        list.updateValue(id, newValue || (id === "botName" ? "buddy" : "unset"));
      },
      () => done(personalizationSummary(config)),
      { enableSearch: true }
    );

    return createPage({
      title: "Personalization",
      subtitle: "Identity and behavior controls. Esc returns to sections.",
      list
    });
  };

  const buildChannelsPage = (done: (value?: string) => void): Component => {
    const list = new SettingsList(
      [
        {
          id: "enabled",
          label: "Discord Enabled",
          description: "Turn the Discord channel on or off",
          currentValue: config.channels.discord.enabled ? "on" : "off",
          values: ["off", "on"]
        },
        {
          id: "botToken",
          label: "Bot Token",
          description: "Stored in plain text",
          currentValue: config.channels.discord.botToken ? "configured" : "not set",
          submenu: (_value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Discord Bot Token",
              subtitle: "Warning: stored in plain text in ~/.buddy/config.json",
              initialValue: config.channels.discord.botToken,
              onSave: (newValue) => {
                void persist({
                  ...config,
                  channels: {
                    discord: {
                      ...config.channels.discord,
                      botToken: newValue
                    }
                  }
                });
                choose(newValue ? "configured" : "not set");
              },
              onCancel: () => choose()
            })
        },
        {
          id: "applicationId",
          label: "Application ID",
          description: "Discord application ID",
          currentValue: config.channels.discord.applicationId || "unset",
          submenu: (value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Discord Application ID",
              subtitle: "Used by the future Discord runtime",
              initialValue: value === "unset" ? "" : value,
              onSave: (newValue) => choose(newValue),
              onCancel: () => choose()
            })
        },
        {
          id: "allowedUsernames",
          label: "Allowed Usernames",
          description: "One Discord username per line. DMs, mentions, and slash commands are limited to this list.",
          currentValue: config.channels.discord.allowedUsernames.length
            ? `${config.channels.discord.allowedUsernames.length} configured`
            : "none",
          submenu: (_value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Allowed Discord Usernames",
              subtitle: "Enter one Discord username per line.",
              initialValue: config.channels.discord.allowedUsernames.join("\n"),
              onSave: (newValue) => {
                const allowedUsernames = newValue
                  .split(/\r?\n/)
                  .map((value) => value.trim())
                  .filter(Boolean);

                void persist({
                  ...config,
                  channels: {
                    discord: {
                      ...config.channels.discord,
                      allowedUsernames
                    }
                  }
                });
                choose(allowedUsernames.length ? `${allowedUsernames.length} configured` : "none");
              },
              onCancel: () => choose()
            })
        }
      ],
      12,
      settingsTheme,
      (id, newValue) => {
        if (id === "enabled") {
          void persist({
            ...config,
            channels: {
              discord: {
                ...config.channels.discord,
                enabled: newValue === "on"
              }
            }
          });
          list.updateValue(id, newValue);
          return;
        }

        if (id === "applicationId") {
          void persist({
            ...config,
            channels: {
              discord: {
                ...config.channels.discord,
                [id]: newValue
              }
            }
          });
          list.updateValue(id, newValue || "unset");
        }
      },
      () => done(channelsSummary(config)),
      { enableSearch: true }
    );

    return createPage({
      title: "Channels",
      subtitle: "Discord configuration, including allowed usernames. Esc returns to sections.",
      list
    });
  };

  const buildRestrictionsPage = (done: (value?: string) => void): Component => {
    const list = new SettingsList(
      [
        {
          id: "accessLevel",
          label: "Access Level",
          description: "Inside the workspace, file tools run freely. Supervised asks approval outside it.",
          currentValue: config.restrictions.accessLevel,
          submenu: (_value, choose) =>
            new SelectDialog({
              title: "Access Level",
              subtitle: "Blocked directories always take priority over access mode",
              items: [
                {
                  value: "full",
                  label: "Full access",
                  description: "All file tools run without approval, except blocked paths"
                },
                {
                  value: "supervised",
                  label: "Supervised",
                  description: "Require approval for file access outside the workspace"
                }
              ],
              onSelect: (item) => choose(item.value),
              onCancel: () => choose()
            })
        },
        {
          id: "blockedDirectories",
          label: "Blocked Directories",
          description: "One path per line. buddy cannot read, edit, write, or delete inside them.",
          currentValue: config.restrictions.blockedDirectories.length
            ? `${config.restrictions.blockedDirectories.length} configured`
            : "none",
          submenu: (_value, choose) =>
            new TextEditorDialog({
              tui,
              title: "Blocked Directories",
              subtitle: "Enter one directory per line. `~` is allowed.",
              initialValue: config.restrictions.blockedDirectories.join("\n"),
              onSave: (newValue) => {
                const blockedDirectories = newValue
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean);

                void persist({
                  ...config,
                  restrictions: {
                    ...config.restrictions,
                    blockedDirectories
                  }
                });
                choose(blockedDirectories.length ? `${blockedDirectories.length} configured` : "none");
              },
              onCancel: () => choose()
            })
        }
      ],
      12,
      settingsTheme,
      (id, newValue) => {
        if (id !== "accessLevel") {
          return;
        }

        void persist({
          ...config,
          restrictions: {
            ...config.restrictions,
            accessLevel: newValue as BuddyConfig["restrictions"]["accessLevel"]
          }
        });
        list.updateValue(id, newValue);
      },
      () => done(restrictionsSummary(config)),
      { enableSearch: true }
    );

    return createPage({
      title: "Restrictions & Guardrails",
      subtitle: "Blocked paths and tool access level. Esc returns to sections.",
      list
    });
  };

  const buildToolsPage = (done: (value?: string) => void): Component => {
    const list = new SettingsList(
      [
        {
          id: "webSearchEnabled",
          label: "Web Search",
          description: "DuckDuckGo HTML search plus text extraction from the top 3 pages",
          currentValue: config.tools.webSearch.enabled ? "on" : "off",
          values: ["off", "on"]
        }
      ],
      12,
      settingsTheme,
      (id, newValue) => {
        if (id !== "webSearchEnabled") {
          return;
        }

        void persist({
          ...config,
          tools: {
            ...config.tools,
            webSearch: {
              ...config.tools.webSearch,
              enabled: newValue === "on"
            }
          }
        });
        list.updateValue(id, newValue);
      },
      () => done(toolsSummary(config)),
      { enableSearch: true }
    );

    return createPage({
      title: "Tools",
      subtitle: "Enable or disable built-in model tools. Esc returns to sections.",
      list
    });
  };

  const rootList = new SettingsList(
    [
      {
        id: "providers",
        label: "Providers",
        description: "Base URL, API key, and model selection",
        currentValue: providersSummary(config),
        submenu: (_value, done) => buildProvidersPage(done)
      },
      {
        id: "personalization",
        label: "Personalization",
        description: "Your name, the bot name, and system instructions",
        currentValue: personalizationSummary(config),
        submenu: (_value, done) => buildPersonalizationPage(done)
      },
      {
        id: "channels",
        label: "Channels",
        description: "Configure where buddy can talk to you",
        currentValue: channelsSummary(config),
        submenu: (_value, done) => buildChannelsPage(done)
      },
      {
        id: "restrictions",
        label: "Restrictions & Guardrails",
        description: "Blocked directories and access level for tool execution",
        currentValue: restrictionsSummary(config),
        submenu: (_value, done) => buildRestrictionsPage(done)
      },
      {
        id: "tools",
        label: "Tools",
        description: "Enable or disable optional assistant tools",
        currentValue: toolsSummary(config),
        submenu: (_value, done) => buildToolsPage(done)
      }
    ] satisfies SettingItem[],
    14,
    settingsTheme,
    () => {},
    () => requestExit(),
    { enableSearch: true }
  );

  const page = createPage({
    title: "buddy config",
    subtitle: "Search sections. Enter opens a section. Esc exits.",
    list: rootList
  });

  root.addChild(page);
  root.addChild(new Text("", 0, 0));
  root.addChild(statusLine);
  tui.addChild(root);
  tui.setFocus(rootList);

  terminal.setTitle("buddy config");
  statusLine.setText(theme.muted("Settings are saved to ~/.buddy/config.json"));

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
