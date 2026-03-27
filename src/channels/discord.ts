import crypto from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type APISelectMenuOption,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type StringSelectMenuInteraction,
  type User
} from "discord.js";
import { conversationDisplayName, saveConversation, type PersistedConversation } from "../conversations/store.js";
import { loadConfig } from "../config/store.js";
import type { DiscordChannelConfig } from "../config/schema.js";
import { executeChatTurn } from "../server/chat.js";
import {
  createOrLoadDiscordConversationForTurn,
  getActiveDiscordConversationId,
  getCurrentDiscordConversation,
  listDiscordConversations,
  preparePendingDiscordConversation,
  setCurrentDiscordConversation
} from "./discord-store.js";
import type { ToolApprovalRequest, ToolRuntimeEvent } from "../tools/runtime.js";

interface DiscordChannelRuntime {
  close(): Promise<void>;
}

type SupportedCommand = "clear" | "new" | "switch" | "config" | "help" | "status" | "exit";

const supportedCommandNames = new Set<SupportedCommand>([
  "clear",
  "new",
  "switch",
  "config",
  "help",
  "status",
  "exit"
]);

const slashCommands = [
  new SlashCommandBuilder().setName("clear").setDescription("Clear the current Discord conversation transcript."),
  new SlashCommandBuilder().setName("new").setDescription("Prepare a fresh Discord conversation."),
  new SlashCommandBuilder().setName("switch").setDescription("Switch to another saved conversation from a dropdown."),
  new SlashCommandBuilder().setName("config").setDescription("Show how to edit buddy configuration."),
  new SlashCommandBuilder().setName("help").setDescription("Show buddy Discord help."),
  new SlashCommandBuilder().setName("status").setDescription("Show whether this Discord conversation is busy or idle."),
  new SlashCommandBuilder().setName("exit").setDescription("End this Discord session and prepare a fresh conversation.")
];

const busyContexts = new Set<string>();
const switchMenuPrefix = "buddy-switch";
const approvalActionPrefix = "buddy-approval";
const pendingSwitchMenus = new Map<
  string,
  {
    contextKey: string;
    userId: string;
  }
>();
const pendingApprovals = new Map<
  string,
  {
    userId: string;
    resolve: (approved: boolean) => void;
    timeout: NodeJS.Timeout;
  }
>();

interface ToolTranscriptState {
  order: string[];
  latestById: Map<string, ToolRuntimeEvent>;
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function isAllowedUser(user: User, config: DiscordChannelConfig): boolean {
  const allowed = new Set(config.allowedUsernames.map(normalizeValue).filter(Boolean));
  if (allowed.size === 0) {
    return false;
  }

  const candidates = [
    user.username,
    user.globalName ?? "",
    user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : ""
  ];

  return candidates.some((candidate) => candidate && allowed.has(normalizeValue(candidate)));
}

function buildContextKey(params: { userId: string; channelId: string; guildId: string | null }): string {
  if (!params.guildId) {
    return `dm:${params.userId}`;
  }

  return `guild:${params.guildId}:channel:${params.channelId}:user:${params.userId}`;
}

function stripBotMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), " ").trim();
}

function parseCommand(input: string): { name: SupportedCommand; argument: string } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const prefixed = trimmed.startsWith("/");
  const normalized = prefixed ? trimmed.slice(1).trim() : trimmed;
  if (!normalized) {
    return null;
  }

  const [rawName, ...rest] = normalized.split(/\s+/);
  const name = rawName.toLowerCase() as SupportedCommand;
  if (!supportedCommandNames.has(name)) {
    return null;
  }

  if (!prefixed && rest.length > 0 && name !== "switch") {
    return null;
  }

  return {
    name,
    argument: rest.join(" ").trim()
  };
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function splitDiscordMessage(content: string, maxLength = 1900): string[] {
  const normalized = content.trim() || "(No response)";
  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const boundary = remaining.lastIndexOf("\n", maxLength);
    const splitAt = boundary > Math.floor(maxLength / 2) ? boundary : maxLength;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function createToolTranscriptState(): ToolTranscriptState {
  return {
    order: [],
    latestById: new Map()
  };
}

function trackToolEvent(state: ToolTranscriptState, event: ToolRuntimeEvent): void {
  if (!state.latestById.has(event.id)) {
    state.order.push(event.id);
  }

  state.latestById.set(event.id, event);
}

function summarizeToolFailure(event: ToolRuntimeEvent): string {
  if (!event.output) {
    return event.summary;
  }

  const condensed = event.output.replace(/\s+/g, " ").trim();
  if (!condensed) {
    return event.summary;
  }

  return truncateText(condensed, 140);
}

function buildToolTranscriptLines(state: ToolTranscriptState): string[] {
  return state.order
    .map((id) => state.latestById.get(id))
    .filter((event): event is ToolRuntimeEvent => Boolean(event))
    .flatMap((event) => {
      if (event.status === "completed") {
        return [`> ${event.summary}`];
      }

      if (event.status === "denied") {
        return [`> Denied: ${event.summary}`];
      }

      if (event.status === "failed") {
        return [`> Failed: ${summarizeToolFailure(event)}`];
      }

      return [];
    });
}

function buildTurnResponse(params: {
  assistantText: string;
  chatId: string;
  toolTranscript: ToolTranscriptState;
}): string {
  const toolLines = buildToolTranscriptLines(params.toolTranscript);
  const content = toolLines.length > 0 ? `${toolLines.join("\n\n")}\n\n${params.assistantText}` : params.assistantText;
  return appendChatIdFooter(content, params.chatId);
}

function appendChatIdFooter(content: string, chatId: string | null): string {
  if (!chatId) {
    return content;
  }

  return `${content.trim()}\n\n-# Chat ID: ${chatId}`;
}

async function respondToMessage(message: Message, content: string): Promise<void> {
  const chunks = splitDiscordMessage(content);

  for (let index = 0; index < chunks.length; index += 1) {
    await message.reply({
      content: chunks[index],
      allowedMentions: {
        repliedUser: index === 0
      }
    });
  }
}

async function respondToInteraction(
  interaction: ChatInputCommandInteraction,
  content: string,
  options?: { ephemeral?: boolean }
): Promise<void> {
  const chunks = splitDiscordMessage(content);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: chunks[0] });
  } else {
    await interaction.reply({ content: chunks[0], ephemeral: options?.ephemeral ?? false });
  }

  for (let index = 1; index < chunks.length; index += 1) {
    await interaction.followUp({ content: chunks[index], ephemeral: options?.ephemeral ?? false });
  }
}

async function respondToSelectInteraction(
  interaction: StringSelectMenuInteraction,
  content: string
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, components: [] });
    return;
  }

  await interaction.update({ content, components: [] });
}

async function sendApprovalEmbed(params: {
  sourceMessage: Message;
  request: ToolApprovalRequest;
  chatId: string | null;
}): Promise<boolean> {
  const approvalId = crypto.randomUUID();
  const approveId = `${approvalActionPrefix}:${approvalId}:approve`;
  const denyId = `${approvalActionPrefix}:${approvalId}:deny`;

  const embed = new EmbedBuilder()
    .setTitle("Tool approval needed")
    .setDescription("A supervised tool call needs your choice before the chat can continue.")
    .addFields(
      { name: "Tool", value: `\`${params.request.toolName}\``, inline: true },
      { name: "Path", value: `\`${params.request.path}\``, inline: false },
      { name: "Action", value: params.request.summary, inline: false }
    );

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(approveId).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(denyId).setLabel("Deny").setStyle(ButtonStyle.Danger)
  );

  const approvalMessage = await params.sourceMessage.reply({
    content: appendChatIdFooter("Approval required before I can continue.", params.chatId),
    embeds: [embed],
    components: [actions],
    allowedMentions: {
      repliedUser: false
    }
  });

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      void approvalMessage.delete().catch(() => {});
      resolve(false);
    }, 5 * 60_000);

    pendingApprovals.set(approvalId, {
      userId: params.sourceMessage.author.id,
      resolve: (approved) => {
        clearTimeout(timeout);
        pendingApprovals.delete(approvalId);
        void approvalMessage.delete().catch(() => {});
        resolve(approved);
      },
      timeout
    });
  });
}

function buildHelpText(botName: string): string {
  return [
    `${botName} supports DMs, server mentions, and slash commands.`,
    "Commands: /clear, /new, /switch, /config, /help, /status, /exit",
    "For message-based commands, `/switch <number|id>` still works as a plain-text fallback.",
    "In servers, mention the bot with your message. In DMs, just send the message directly."
  ].join("\n");
}

function buildSwitchOptions(params: {
  currentConversationId: string | null;
  conversations: PersistedConversation[];
}): APISelectMenuOption[] {
  return params.conversations.slice(0, 25).map((conversation, index) => ({
    label: truncateText(conversationDisplayName(conversation), 100),
    description: truncateText(
      `${conversation.id === params.currentConversationId ? "Current · " : ""}${formatTimestamp(conversation.updatedAt)} · ${conversation.id}`,
      100
    ),
    value: conversation.id,
    default: conversation.id === params.currentConversationId
  }));
}

async function openSwitchMenu(params: {
  interaction: ChatInputCommandInteraction;
  contextKey: string;
}): Promise<void> {
  const conversations = await listDiscordConversations();
  const chatId = await getActiveDiscordConversationId(params.contextKey);

  if (conversations.length === 0) {
    await respondToInteraction(
      params.interaction,
      appendChatIdFooter("No saved conversations exist yet.", chatId),
      {
        ephemeral: true
      }
    );
    return;
  }

  const currentConversationId = await getActiveDiscordConversationId(params.contextKey);
  const menuId = `${switchMenuPrefix}:${crypto.randomUUID()}`;
  pendingSwitchMenus.set(menuId, {
    contextKey: params.contextKey,
    userId: params.interaction.user.id
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(menuId)
    .setPlaceholder("Choose a conversation")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      buildSwitchOptions({
        currentConversationId,
        conversations
      })
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  await params.interaction.reply({
    content: appendChatIdFooter("Pick the conversation to switch to:", chatId),
    components: [row],
    ephemeral: true
  });
}

async function handleConversationCommand(params: {
  contextKey: string;
  command: SupportedCommand;
  argument: string;
  isBusy: boolean;
  botName: string;
}): Promise<string> {
  if (params.command === "clear") {
    if (params.isBusy) {
      return "This conversation is busy right now.";
    }

    const conversation = await getCurrentDiscordConversation(params.contextKey);
    if (!conversation) {
      return "There is no saved chat selected yet.";
    }

    await saveConversation({
      ...conversation,
      name: null,
      messages: []
    });
    await setCurrentDiscordConversation(params.contextKey, conversation.id);
    return "Cleared the current conversation.";
  }

  if (params.command === "new") {
    await preparePendingDiscordConversation(params.contextKey);
    return "Ready for a fresh chat. It will be created when you send the first message.";
  }

  if (params.command === "switch") {
    const conversations = await listDiscordConversations();
    if (conversations.length === 0) {
      return "No saved conversations exist yet.";
    }

    if (!params.argument) {
      const currentConversationId = await getActiveDiscordConversationId(params.contextKey);
      const lines = conversations.slice(0, 10).map((conversation, index) => {
        const prefix = conversation.id === currentConversationId ? "*" : " ";
        return `${prefix} ${index + 1}. ${conversationDisplayName(conversation)} (${conversation.id}) · ${formatTimestamp(conversation.updatedAt)}`;
      });

      return [
        "Saved conversations:",
        ...lines,
        "Use `/switch` from the slash-command menu, or `/switch <number|conversation-id>` as a text fallback."
      ].join("\n");
    }

    const byIndex = Number(params.argument);
    const selected =
      Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= conversations.length
        ? conversations[byIndex - 1]
        : conversations.find((conversation) => conversation.id === params.argument);

    if (!selected) {
      return `Could not find a conversation matching "${params.argument}".`;
    }

    await setCurrentDiscordConversation(params.contextKey, selected.id);
    return `Switched to ${conversationDisplayName(selected)} (${selected.id}).`;
  }

  if (params.command === "config") {
    return "Configuration lives in the local TUI. Run `buddy --config` on the machine hosting the server.";
  }

  if (params.command === "help") {
    return buildHelpText(params.botName);
  }

  if (params.command === "status") {
    const conversation = await getCurrentDiscordConversation(params.contextKey);
    if (conversation) {
      return `Status: ${params.isBusy ? "busy" : "idle"}\nConversation: ${conversationDisplayName(conversation)} (${conversation.id})`;
    }

    const pendingChatId = await getActiveDiscordConversationId(params.contextKey);
    if (pendingChatId) {
      return `Status: ${params.isBusy ? "busy" : "idle"}\nConversation: pending (${pendingChatId})`;
    }

    return `Status: ${params.isBusy ? "busy" : "idle"}\nConversation: none selected yet.`;
  }

  if (params.command === "exit") {
    await preparePendingDiscordConversation(params.contextKey);
    return "Ended the current session. Your next message will create a fresh chat.";
  }

  return `Unknown command: ${params.command}`;
}

async function runConversationTurn(params: {
  contextKey: string;
  userInput: string;
  sourceMessage: Message;
}): Promise<{ content: string; chatId: string }> {
  const conversation = await createOrLoadDiscordConversationForTurn(params.contextKey);
  const pendingMessages = [...conversation.messages, { role: "user" as const, content: params.userInput }];
  const savedPendingConversation = await saveConversation({
    ...conversation,
    messages: pendingMessages
  });

  await setCurrentDiscordConversation(params.contextKey, savedPendingConversation.id);

  const toolTranscript = createToolTranscriptState();

  const result = await executeChatTurn({
    messages: conversation.messages,
    userInput: params.userInput,
    channel: "discord",
    onToolEvent: (event) => {
      trackToolEvent(toolTranscript, event);
    },
    requestApproval: async (request) =>
      await sendApprovalEmbed({
        sourceMessage: params.sourceMessage,
        request,
        chatId: savedPendingConversation.id
      })
  });

  await saveConversation({
    ...savedPendingConversation,
    messages: result.messages
  });

  return {
    content: buildTurnResponse({
      assistantText: result.assistantText,
      chatId: savedPendingConversation.id,
      toolTranscript
    }),
    chatId: savedPendingConversation.id
  };
}

async function registerSlashCommands(config: DiscordChannelConfig): Promise<void> {
  if (!config.applicationId.trim()) {
    console.warn("Discord application ID is not configured. Slash command registration was skipped.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(config.botToken);
  const body = slashCommands.map((command) => command.toJSON());

  await rest.put(Routes.applicationCommands(config.applicationId), { body });
}

async function withFreshDiscordConfig<T>(
  action: (config: DiscordChannelConfig, botName: string) => Promise<T>
): Promise<T> {
  const config = await loadConfig();
  return await action(config.channels.discord, config.personalization.botName || "buddy");
}

export async function startDiscordChannel(): Promise<DiscordChannelRuntime | null> {
  const config = await loadConfig();
  if (!config.channels.discord.enabled) {
    return null;
  }

  if (!config.channels.discord.botToken.trim()) {
    throw new Error("Discord is enabled, but the bot token is not configured.");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  client.on(Events.Error, (error) => {
    console.error(`Discord client error: ${error.message}`);
  });

  client.on(Events.MessageCreate, (message) => {
    void withFreshDiscordConfig(async (discordConfig, botName) => {
      if (message.author.bot || !client.user) {
        return;
      }

      const isDm = message.channel.type === ChannelType.DM;
      const isMention = !isDm && message.mentions.has(client.user);
      const isBroadcastOnly = !isMention && message.mentions.everyone;
      if (isBroadcastOnly || (!isDm && !isMention)) {
        return;
      }

      if (!isAllowedUser(message.author, discordConfig)) {
        if (isDm) {
          await respondToMessage(message, "You are not allowed to use this buddy Discord bot.");
        }
        return;
      }

      const contextKey = buildContextKey({
        userId: message.author.id,
        channelId: message.channelId,
        guildId: message.guildId
      });
      const rawInput = isDm ? message.content.trim() : stripBotMention(message.content, client.user.id);
      if (!rawInput) {
        await respondToMessage(
          message,
          appendChatIdFooter(buildHelpText(botName), await getActiveDiscordConversationId(contextKey))
        );
        return;
      }

      const command = parseCommand(rawInput);
      if (command) {
        const response = await handleConversationCommand({
          contextKey,
          command: command.name,
          argument: command.argument,
          isBusy: busyContexts.has(contextKey),
          botName
        });
        await respondToMessage(
          message,
          appendChatIdFooter(response, await getActiveDiscordConversationId(contextKey))
        );
        return;
      }

      if (busyContexts.has(contextKey)) {
        await respondToMessage(
          message,
          appendChatIdFooter(
            "This conversation is already busy. Try again in a moment.",
            await getActiveDiscordConversationId(contextKey)
          )
        );
        return;
      }

      busyContexts.add(contextKey);

      try {
        await message.channel.sendTyping();
        const response = await runConversationTurn({
          contextKey,
          userInput: rawInput,
          sourceMessage: message
        });
        await respondToMessage(message, response.content);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await respondToMessage(
          message,
          appendChatIdFooter(`Error: ${text}`, await getActiveDiscordConversationId(contextKey))
        );
      } finally {
        busyContexts.delete(contextKey);
      }
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void withFreshDiscordConfig(async (discordConfig, botName) => {
      if (interaction.isButton()) {
        if (!interaction.customId.startsWith(`${approvalActionPrefix}:`)) {
          return;
        }

        const [, approvalId, decision] = interaction.customId.split(":");
        const pending = approvalId ? pendingApprovals.get(approvalId) : undefined;
        if (!pending) {
          await interaction.reply({
            content: "That approval request has expired.",
            ephemeral: true
          });
          return;
        }

        if (interaction.user.id !== pending.userId) {
          await interaction.reply({
            content: "Only the person who started this chat can approve or deny tool calls.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferUpdate();
        pending.resolve(decision === "approve");
        return;
      }

      if (interaction.isStringSelectMenu()) {
        if (!interaction.customId.startsWith(`${switchMenuPrefix}:`)) {
          return;
        }

        const pending = pendingSwitchMenus.get(interaction.customId);
        if (!pending) {
          await respondToSelectInteraction(interaction, "That switch menu has expired. Run `/switch` again.");
          return;
        }

        if (interaction.user.id !== pending.userId) {
          await interaction.reply({
            content: "Only the person who opened this switch menu can use it.",
            ephemeral: true
          });
          return;
        }

        pendingSwitchMenus.delete(interaction.customId);

        const selectedId = interaction.values[0];
        const conversations = await listDiscordConversations();
        const selected = conversations.find((conversation) => conversation.id === selectedId);
        if (!selected) {
          await respondToSelectInteraction(interaction, "That conversation is no longer available. Run `/switch` again.");
          return;
        }

        await setCurrentDiscordConversation(pending.contextKey, selected.id);
        await respondToSelectInteraction(
          interaction,
          appendChatIdFooter(`Switched to ${conversationDisplayName(selected)} (${selected.id}).`, selected.id)
        );
        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      if (!supportedCommandNames.has(interaction.commandName as SupportedCommand)) {
        return;
      }

      if (!isAllowedUser(interaction.user, discordConfig)) {
        await respondToInteraction(interaction, "You are not allowed to use this buddy Discord bot.", {
          ephemeral: true
        });
        return;
      }

      const contextKey = buildContextKey({
        userId: interaction.user.id,
        channelId: interaction.channelId,
        guildId: interaction.guildId
      });

      const command = interaction.commandName as SupportedCommand;
      if (command === "switch") {
        await openSwitchMenu({
          interaction,
          contextKey
        });
        return;
      }

      const response = await handleConversationCommand({
        contextKey,
        command,
        argument: "",
        isBusy: busyContexts.has(contextKey),
        botName
      });
      await respondToInteraction(
        interaction,
        appendChatIdFooter(response, await getActiveDiscordConversationId(contextKey)),
        { ephemeral: true }
      );
    });
  });

  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });

  await client.login(config.channels.discord.botToken);
  await ready;
  await registerSlashCommands(config.channels.discord);

  console.log(`Discord bot ready as ${client.user?.tag ?? "unknown user"}`);

  return {
    async close(): Promise<void> {
      busyContexts.clear();
      pendingSwitchMenus.clear();
      for (const pending of pendingApprovals.values()) {
        clearTimeout(pending.timeout);
        pending.resolve(false);
      }
      pendingApprovals.clear();
      client.destroy();
    }
  };
}
