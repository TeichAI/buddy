import { loadConfig } from "../config/store.js";
import { runAgentTurn, type AgentTurnResult } from "../llm/agent.js";
import { buildSystemPrompt, type PromptChannel } from "../llm/system-prompt.js";
import { createToolContext, type ToolContext } from "../tools/file-tools.js";
import { createToolRegistry } from "../tools/registry.js";
import { createToolRuntime, type ToolApprovalRequest, type ToolRuntimeEvent } from "../tools/runtime.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

let lastPluginDiagnostics = "";

function reportPluginDiagnostics(diagnostics: { pluginPath: string; message: string }[]): void {
  const next = diagnostics
    .map((diagnostic) => `${diagnostic.pluginPath}: ${diagnostic.message}`)
    .sort()
    .join("\n");

  if (!next || next === lastPluginDiagnostics) {
    return;
  }

  lastPluginDiagnostics = next;
  console.warn(`Buddy plugin load warnings:\n${next}`);
}

function withCurrentSystemPrompt(messages: ChatCompletionMessageParam[], systemPrompt: string): ChatCompletionMessageParam[] {
  const nextMessages = messages.filter((message) => message.role !== "system");
  return [
    {
      role: "system",
      content: systemPrompt
    },
    ...nextMessages
  ];
}

export async function executeChatTurn(params: {
  messages: ChatCompletionMessageParam[];
  userInput: string;
  channel?: PromptChannel;
  toolContext?: ToolContext;
  onToolEvent?: (event: ToolRuntimeEvent) => void;
  requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
}): Promise<AgentTurnResult> {
  const config = await loadConfig();
  const toolContext = params.toolContext ?? createToolContext();
  const toolRegistry = await createToolRegistry(config, toolContext);
  reportPluginDiagnostics(toolRegistry.diagnostics);
  const toolRuntime = createToolRuntime(
    config,
    toolRegistry,
    {
      requestApproval: params.requestApproval ?? (async () => false),
      onEvent: params.onToolEvent
    }
  );

  return await runAgentTurn({
    config,
    messages: withCurrentSystemPrompt(
      params.messages,
      buildSystemPrompt(config, params.channel ?? "local", toolRegistry.promptLines)
    ),
    userInput: params.userInput,
    toolRuntime,
    toolRegistry
  });
}
