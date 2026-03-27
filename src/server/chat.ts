import { loadConfig } from "../config/store.js";
import { runAgentTurn, type AgentTurnResult } from "../llm/agent.js";
import { buildSystemPrompt, type PromptChannel } from "../llm/system-prompt.js";
import { createToolContext, type ToolContext } from "../tools/file-tools.js";
import { createToolRuntime, type ToolApprovalRequest, type ToolRuntimeEvent } from "../tools/runtime.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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
  const toolRuntime = createToolRuntime(
    config,
    {
      requestApproval: params.requestApproval ?? (async () => false),
      onEvent: params.onToolEvent
    },
    params.toolContext ?? createToolContext()
  );

  return await runAgentTurn({
    config,
    messages: withCurrentSystemPrompt(params.messages, buildSystemPrompt(config, params.channel ?? "local")),
    userInput: params.userInput,
    toolRuntime
  });
}
