export interface BuddyJsonSchema {
  [key: string]: unknown;
  type?: string;
  description?: string;
  properties?: Record<string, BuddyJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: BuddyJsonSchema | BuddyJsonSchema[];
  enum?: Array<string | number | boolean | null>;
  oneOf?: BuddyJsonSchema[];
  anyOf?: BuddyJsonSchema[];
  allOf?: BuddyJsonSchema[];
  const?: unknown;
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface BuddyToolDisplay {
  summary: string;
  path?: string;
}

export interface BuddyToolContext {
  buddyHome: string;
  workspacePath: string;
  callId: string;
  pluginId: string;
  toolId: string;
  toolName: string;
}

export interface BuddyToolApprovalRequest<T = string> {
  summary: string;
  path?: string;
  reason?: string;
  continueWith: () => Promise<T> | T;
}

export interface BuddyToolDeferredApproval<T = string> extends BuddyToolApprovalRequest<T> {
  __buddyType: "approval_request";
}

export type BuddyToolResult = string | BuddyToolDeferredApproval<string>;

export type BuddyToolHandler = (
  context: BuddyToolContext,
  args: Record<string, unknown>
) => Promise<BuddyToolResult> | BuddyToolResult;

export interface BuddyTool {
  id: string;
  description: string;
  parameters: BuddyJsonSchema;
  requiresApproval?: boolean;
  summarize: (args: Record<string, unknown>) => BuddyToolDisplay | string;
  execute: BuddyToolHandler;
}

export interface BuddyPlugin {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  repositoryUrl?: string;
  tools: BuddyTool[];
}

export function definePlugin<T extends BuddyPlugin>(plugin: T): T {
  return plugin;
}

export function defineTool<T extends BuddyTool>(tool: T): T {
  return tool;
}

export function requestApproval<T = string>(
  request: BuddyToolApprovalRequest<T>
): BuddyToolDeferredApproval<T> {
  return {
    __buddyType: "approval_request",
    ...request
  };
}

export function isBuddyToolDeferredApproval(
  value: unknown
): value is BuddyToolDeferredApproval<string> {
  return (
    typeof value === "object" &&
    value !== null &&
    "__buddyType" in value &&
    value.__buddyType === "approval_request" &&
    "summary" in value &&
    typeof value.summary === "string" &&
    "continueWith" in value &&
    typeof value.continueWith === "function"
  );
}
