import type { Component } from "@mariozechner/pi-tui";
import { CombinedAutocompleteProvider, ProcessTerminal, TUI, Text } from "@mariozechner/pi-tui";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { loadConfig } from "../config/store.js";
import type { BuddyConfig } from "../config/schema.js";
import { BuddySocketClient } from "../server/client.js";
import { getCliCurrentConversationId, setCliCurrentConversationId } from "../current/store.js";
import { ChatLog } from "./components/chat-log.js";
import { ApprovalDialog } from "./components/approval-dialog.js";
import { CustomEditor } from "./components/custom-editor.js";
import { editorTheme, theme } from "./theme.js";
import type { ToolRuntimeEvent } from "../tools/runtime.js";
import {
  conversationDisplayName,
  createConversation,
  deleteConversation,
  listConversations,
  loadConversation,
  loadLatestConversation,
  saveConversation,
  type PersistedConversation
} from "../conversations/store.js";
import { ConversationSelectDialog } from "./components/conversation-select-dialog.js";

class Divider implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    return [theme.border("─".repeat(Math.max(8, width - 1)))];
  }
}

class BlankSpace implements Component {
  constructor(private readonly lines: number) {}

  invalidate(): void {}

  render(width: number): string[] {
    return Array.from({ length: Math.max(0, this.lines) }, () => " ".repeat(Math.max(0, width - 1)));
  }
}

function buildMetaLine(config: BuddyConfig, status: string): string {
  return [
    config.providers.label,
    config.providers.model || "unset",
    `discord ${config.channels.discord.enabled ? "on" : "off"}`,
    status
  ].join("  ·  ");
}

function buildHelpLine(): string {
  return "Enter send  ·  /new chat  ·  /switch chats  ·  /clear reset  ·  /exit quit";
}

function messageText(content: ChatCompletionMessageParam["content"] | null | undefined): string {
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

      return part.type === "text" ? part.text : "";
    })
    .join("")
    .trim();
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function rebuildChatLog(params: {
  chatLog: ChatLog;
  conversation: PersistedConversation;
  userName: string;
  botName: string;
}): void {
  params.chatLog.clearMessages();

  for (const message of params.conversation.messages) {
    const text = messageText(message.content);
    if (!text) {
      continue;
    }

    if (message.role === "user") {
      params.chatLog.addUser(params.userName, text);
      continue;
    }

    if (message.role === "assistant") {
      params.chatLog.addAssistant(params.botName, text);
    }
  }
}

const slashCommands = [
  { name: "clear", description: "Reset the current chat transcript." },
  { name: "config", description: "Show how to open the configuration UI." },
  { name: "help", description: "Show available chat shortcuts." },
  { name: "new", description: "Start a fresh conversation." },
  { name: "status", description: "Show whether the assistant is idle or busy." },
  { name: "switch", description: "Reopen a saved conversation." },
  { name: "exit", description: "Quit the chat UI." }
] as const;

export async function runChatTui(): Promise<void> {
  let config = await loadConfig();
  const currentConversationId = await getCliCurrentConversationId();
  let conversation: PersistedConversation;

  if (currentConversationId) {
    try {
      conversation = await loadConversation(currentConversationId);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        conversation = {
          ...(await createConversation()),
          id: currentConversationId
        };
      } else {
        throw error;
      }
    }
  } else {
    conversation = (await loadLatestConversation()) ?? (await createConversation());
  }

  await setCliCurrentConversationId(conversation.id);
  let messages: ChatCompletionMessageParam[] = conversation.messages;
  let conversationSaved = conversation.messages.length > 0;

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, true);
  const socketClient = new BuddySocketClient();
  const title = new Text("", 0, 0);
  const subtitle = new Text("", 0, 0);
  const topDivider = new Divider();
  const chatLog = new ChatLog();
  const chatPaddingTop = new BlankSpace(2);
  const emptyState = new Text("", 0, 0);
  const chatPaddingBottom = new BlankSpace(5);
  const bottomDivider = new Divider();
  const helpLine = new Text(theme.muted(buildHelpLine()), 0, 0);
  const inputLabel = new Text("", 0, 0);
  const editor = new CustomEditor(tui, editorTheme, {
    paddingX: 1,
    autocompleteMaxVisible: 8
  });
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider([...slashCommands]));

  tui.addChild(title);
  tui.addChild(subtitle);
  tui.addChild(topDivider);
  tui.addChild(chatPaddingTop);
  tui.addChild(chatLog);
  tui.addChild(emptyState);
  tui.addChild(chatPaddingBottom);
  tui.addChild(bottomDivider);
  tui.addChild(helpLine);
  tui.addChild(inputLabel);
  tui.addChild(editor);
  tui.setFocus(editor);

  let isBusy = false;
  let exiting = false;
  let lastCtrlCAt = 0;
  const handleToolEvent = (event: ToolRuntimeEvent) => {
    chatLog.upsertTool({
      id: event.id,
      toolName: event.toolName,
      path: event.path,
      summary: event.summary,
      status: event.status,
      output: event.output
    });
    tui.requestRender();
  };
  const requestApproval = async (params: {
    id: string;
    toolName: string;
    path: string;
    summary: string;
  }): Promise<boolean> =>
    new Promise((resolve) => {
      const dialog = new ApprovalDialog({
        toolName: params.toolName,
        path: params.path,
        summary: params.summary,
        onSelect: (value) => {
          overlay.hide();
          tui.setFocus(editor);
          resolve(value === "approve");
        },
        onCancel: () => {
          overlay.hide();
          tui.setFocus(editor);
          resolve(false);
        }
      });

      const overlay = tui.showOverlay(dialog, {
        anchor: "center",
        width: "72%",
        maxHeight: "60%"
      });
    });
  const renderChrome = (status: string) => {
    title.setText(theme.title(`${config.personalization.botName || "buddy"}  ·  ${conversationDisplayName(conversation)}`));
    subtitle.setText(theme.muted(buildMetaLine(config, status)));
    inputLabel.setText(theme.accent(`${config.personalization.userName || "you"} >`));
    helpLine.setText(
      theme.muted("Enter send  ·  /new chat  ·  /switch chats  ·  buddy --config settings  ·  /exit quit")
    );
    tui.requestRender();
  };

  const persistConversation = async (nextConversation: PersistedConversation): Promise<void> => {
    conversation = await saveConversation(nextConversation);
    messages = conversation.messages;
    conversationSaved = true;
    await setCliCurrentConversationId(conversation.id);
  };

  const switchConversation = async (nextConversation: PersistedConversation, status = "idle"): Promise<void> => {
    conversation = nextConversation;
    messages = nextConversation.messages;
    conversationSaved = nextConversation.messages.length > 0;
    await setCliCurrentConversationId(nextConversation.id);
    rebuildChatLog({
      chatLog,
      conversation: nextConversation,
      userName: config.personalization.userName || "you",
      botName: config.personalization.botName || "buddy"
    });
    renderChrome(status);
  };

  const showConversationSelector = async (): Promise<void> =>
    await new Promise((resolve) => {
      void (async () => {
        const conversations = await listConversations();
        if (conversations.length === 0) {
          await switchConversation(await createConversation(), "new chat");
          resolve();
          return;
        }

        const items = conversations.map((entry) => ({
          value: entry.id,
          label: conversationDisplayName(entry),
          description: `${formatTimestamp(entry.updatedAt)}  ·  ${entry.id}`
        }));

        const dialog = new ConversationSelectDialog({
          title: "Switch Conversation",
          subtitle: "Select a saved chat to reopen.",
          items,
          onSelect: (item) => {
            overlay.hide();
            tui.setFocus(editor);
            void (async () => {
              const selected = await loadConversation(String(item.value));
              await switchConversation(selected, "switched conversation");
              resolve();
            })();
          },
          onDelete: (item) => {
            void (async () => {
              try {
                const deletedId = String(item.value);
                await deleteConversation(deletedId);

                if (deletedId === conversation.id) {
                  const fallbackConversation = (await loadLatestConversation()) ?? (await createConversation());
                  await switchConversation(fallbackConversation, "deleted conversation");
                }

                const remainingConversations = await listConversations();
                if (remainingConversations.length === 0) {
                  overlay.hide();
                  tui.setFocus(editor);
                  if (deletedId !== conversation.id) {
                    await switchConversation(await createConversation(), "deleted conversation");
                  }
                  resolve();
                  return;
                }

                dialog.setItems(
                  remainingConversations.map((entry) => ({
                    value: entry.id,
                    label: conversationDisplayName(entry),
                    description: `${formatTimestamp(entry.updatedAt)}  ·  ${entry.id}`
                  }))
                );
                renderChrome("deleted conversation");
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                chatLog.addSystem(`Error: ${message}`);
                renderChrome("error");
              }
            })();
          },
          onCancel: () => {
            overlay.hide();
            tui.setFocus(editor);
            renderChrome(isBusy ? "busy" : "idle");
            resolve();
          }
        });

        const overlay = tui.showOverlay(dialog, {
          anchor: "center",
          width: "72%",
          maxHeight: "60%"
        });
      })();
    });

  const requestExit = () => {
    if (exiting) {
      return;
    }

    exiting = true;
    terminal.setTitle("buddy");
    tui.stop();
  };

  const handleCommand = async (commandLine: string): Promise<void> => {
    const [command] = commandLine.split(/\s+/, 1);

    if (isBusy && ["/clear", "/new", "/switch"].includes(command)) {
      renderChrome("busy");
      return;
    }

    if (command === "/clear") {
      chatLog.clearMessages();
      const clearedConversation = {
        ...conversation,
        name: null,
        messages: []
      };
      if (conversationSaved) {
        await persistConversation(clearedConversation);
      } else {
        conversation = clearedConversation;
        messages = clearedConversation.messages;
        await setCliCurrentConversationId(conversation.id);
      }
      renderChrome("chat cleared");
      return;
    }

    if (command === "/new") {
      await switchConversation(await createConversation(), "new chat");
      return;
    }

    if (command === "/switch") {
      if (isBusy) {
        renderChrome("busy");
        return;
      }

      await showConversationSelector();
      return;
    }

    if (command === "/config") {
      chatLog.addSystem("Settings moved to a standalone TUI. Run `buddy --config`.");
      renderChrome("use --config");
      return;
    }

    if (command === "/help") {
      renderChrome("help");
      return;
    }

    if (command === "/status") {
      renderChrome(isBusy ? "busy" : "idle");
      return;
    }

    if (command === "/exit") {
      requestExit();
      return;
    }

    chatLog.addSystem(`Unknown command: ${commandLine}`);
    renderChrome("unknown command");
  };

  editor.onSubmit = (value) => {
    const line = value.trim();
    editor.setText("");

    if (!line) {
      return;
    }

    editor.addToHistory(line);
    void (async () => {
      if (line.startsWith("/")) {
        await handleCommand(line);
        return;
      }

      if (isBusy) {
        renderChrome("busy");
        return;
      }

      const author = config.personalization.userName || "you";
      const botName = config.personalization.botName || "buddy";

      isBusy = true;
      chatLog.addUser(author, line);
      renderChrome("thinking");

      try {
        const historyBeforeTurn = messages;
        const pendingMessages = [...historyBeforeTurn, { role: "user" as const, content: line }];
        await persistConversation({
          ...conversation,
          messages: pendingMessages
        });

        const result = await socketClient.sendChatTurn({
          messages: historyBeforeTurn,
          userInput: line,
          onToolEvent: handleToolEvent,
          requestApproval
        });
        await persistConversation({
          ...conversation,
          messages: result.messages
        });
        chatLog.addAssistant(botName, result.assistantText);
        renderChrome("idle");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        chatLog.addSystem(`Error: ${message}`);
        renderChrome("error");
      } finally {
        isBusy = false;
      }
    })();
  };

  editor.onEscape = () => {
    editor.setText("");
    renderChrome(isBusy ? "busy" : "idle");
  };

  editor.onCtrlC = () => {
    const hasInput = editor.getText().trim().length > 0;
    const now = Date.now();

    if (hasInput) {
      editor.setText("");
      lastCtrlCAt = now;
      renderChrome("input cleared; press ctrl+c again to exit");
      return;
    }

    if (now - lastCtrlCAt <= 1000) {
      requestExit();
      return;
    }

    lastCtrlCAt = now;
    renderChrome("press ctrl+c again to exit");
  };

  editor.onCtrlD = () => {
    requestExit();
  };

  terminal.setTitle("buddy");
  terminal.clearScreen();
  rebuildChatLog({
    chatLog,
    conversation,
    userName: config.personalization.userName || "you",
    botName: config.personalization.botName || "buddy"
  });
  renderChrome("idle");

  await new Promise<void>((resolve) => {
    const sigintHandler = () => requestExit();
    const sigtermHandler = () => requestExit();

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    const originalStop = tui.stop.bind(tui);
    tui.stop = () => {
      void (async () => {
        await socketClient.close();
        originalStop();
        process.removeListener("SIGINT", sigintHandler);
        process.removeListener("SIGTERM", sigtermHandler);
        resolve();
      })();
    };

    tui.start();
  });
}
