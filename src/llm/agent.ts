import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam
} from "openai/resources/chat/completions";
import type { BuddyConfig } from "../config/schema.js";
import type { ToolRuntime } from "../tools/runtime.js";

export interface AgentTurnResult {
  messages: ChatCompletionMessageParam[];
  assistantText: string;
}

const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a text file from disk before making edits or answering questions about it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to read." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List directory contents so you can discover files and folders before reading or editing them.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to inspect." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Create or fully replace a file with the provided content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to write." },
          content: { type: "string", description: "Complete file contents." }
        },
        required: ["path", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description: "Edit a file after reading it first. Provide the full new contents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to edit." },
          newContent: { type: "string", description: "The complete updated file contents." }
        },
        required: ["path", "newContent"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file from disk.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to delete." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "create_directory",
      description: "Create a directory. Relative paths are resolved inside the workspace by default.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to create." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  }
];

function assistantContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item) {
          return typeof item.text === "string" ? item.text : "";
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

export async function runAgentTurn(params: {
  config: BuddyConfig;
  messages: ChatCompletionMessageParam[];
  userInput: string;
  toolRuntime: ToolRuntime;
}): Promise<AgentTurnResult> {
  const { config, toolRuntime, userInput } = params;

  if (!config.providers.baseUrl || !config.providers.apiKey || !config.providers.model) {
    throw new Error("Provider is not fully configured. Run `buddy --config` and complete Providers.");
  }

  const client = new OpenAI({
    apiKey: config.providers.apiKey,
    baseURL: config.providers.baseUrl
  });

  const workingMessages: ChatCompletionMessageParam[] = [
    ...params.messages,
    { role: "user", content: userInput }
  ];

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const response = await client.chat.completions.create({
      model: config.providers.model,
      messages: workingMessages,
      tools: toolDefinitions,
      tool_choice: "auto",
      temperature: 0.3
    });

    const assistant = response.choices[0]?.message;
    if (!assistant) {
      throw new Error("The provider returned no assistant message.");
    }

    const toolCalls = assistant.tool_calls ?? [];
    const assistantText = assistantContentToText(assistant.content);

    if (toolCalls.length === 0) {
      workingMessages.push({
        role: "assistant",
        content: assistantText || "(No response)"
      });

      return {
        messages: workingMessages,
        assistantText: assistantText || "(No response)"
      };
    }

    workingMessages.push({
      role: "assistant",
      content: assistant.content ?? "",
      tool_calls: toolCalls
    } as ChatCompletionAssistantMessageParam);

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") {
        continue;
      }

      const result = await toolRuntime.executeTool(
        toolCall.function.name,
        toolCall.function.arguments || "{}",
        { callId: toolCall.id }
      );

      workingMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.output
      } as ChatCompletionToolMessageParam);
    }
  }

  throw new Error("Tool loop exceeded the maximum number of iterations.");
}
