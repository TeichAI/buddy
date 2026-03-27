import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { BuddyConfig } from "../config/schema.js";
import type { ToolApprovalRequest, ToolRuntimeEvent } from "../tools/runtime.js";

export interface ClientAuthMessage {
  type: "auth";
  token: string;
}

export interface ChatTurnRequestMessage {
  type: "chat_turn";
  requestId: string;
  messages: ChatCompletionMessageParam[];
  userInput: string;
}

export interface ApprovalResponseMessage {
  type: "approval_response";
  requestId: string;
  approvalId: string;
  approved: boolean;
}

export interface StatusRequestMessage {
  type: "status";
  requestId: string;
}

export interface ConfigRequestMessage {
  type: "get_config";
  requestId: string;
}

export interface UpdateConfigRequestMessage {
  type: "update_config";
  requestId: string;
  config: BuddyConfig;
}

export interface ShutdownRequestMessage {
  type: "shutdown";
  requestId: string;
}

export type ClientMessage =
  | ClientAuthMessage
  | ChatTurnRequestMessage
  | ApprovalResponseMessage
  | StatusRequestMessage
  | ConfigRequestMessage
  | UpdateConfigRequestMessage
  | ShutdownRequestMessage;

export interface ServerAuthOkMessage {
  type: "auth_ok";
}

export interface ServerErrorMessage {
  type: "error";
  message: string;
  requestId?: string;
}

export interface ToolEventMessage {
  type: "tool_event";
  requestId: string;
  event: ToolRuntimeEvent;
}

export interface ApprovalRequestMessage {
  type: "approval_request";
  requestId: string;
  approvalId: string;
  request: ToolApprovalRequest;
}

export interface ChatTurnResultMessage {
  type: "chat_result";
  requestId: string;
  messages: ChatCompletionMessageParam[];
  assistantText: string;
}

export interface StatusResultMessage {
  type: "status_result";
  requestId: string;
  pid: number;
}

export interface ConfigResultMessage {
  type: "config_result";
  requestId: string;
  config: BuddyConfig;
}

export interface UpdateConfigResultMessage {
  type: "update_config_result";
  requestId: string;
  config: BuddyConfig;
}

export interface ShutdownResultMessage {
  type: "shutdown_result";
  requestId: string;
}

export type ServerMessage =
  | ServerAuthOkMessage
  | ServerErrorMessage
  | ToolEventMessage
  | ApprovalRequestMessage
  | ChatTurnResultMessage
  | StatusResultMessage
  | ConfigResultMessage
  | UpdateConfigResultMessage
  | ShutdownResultMessage;
