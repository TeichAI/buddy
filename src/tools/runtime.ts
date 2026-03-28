import type { BuddyConfig } from "../config/schema.js";
import { isBuddyToolDeferredApproval } from "../plugins/sdk.js";
import { workspacePath } from "../utils/paths.js";
import type { ToolDisplayMetadata, ToolRegistry, ToolSourceMetadata } from "./registry.js";
import {
  isPathBlocked,
  isPathInsideDirectory,
  resolvePolicyPath
} from "./path-utils.js";

export interface ToolApprovalRequest {
  id: string;
  toolName: string;
  path: string;
  summary: string;
  reason?: string;
  source?: ToolSourceMetadata;
}

export type ToolEventStatus =
  | "running"
  | "awaiting_approval"
  | "completed"
  | "denied"
  | "failed";

export interface ToolRuntimeEvent {
  id: string;
  toolName: string;
  path: string;
  summary: string;
  status: ToolEventStatus;
  output?: string;
  source?: ToolSourceMetadata;
}

export interface ToolRuntimeCallbacks {
  requestApproval: (request: ToolApprovalRequest) => Promise<boolean>;
  onEvent?: (event: ToolRuntimeEvent) => void;
}

export interface ToolExecutionResult {
  ok: boolean;
  output: string;
  displayPath?: string;
}

export interface ToolRuntime {
  executeTool(name: string, rawArgs: string, options?: { callId?: string }): Promise<ToolExecutionResult>;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArguments(rawArgs: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object.");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid tool arguments: ${stringifyError(error)}`);
  }
}

function buildFailureEvent(params: {
  id: string;
  toolName: string;
  display: ToolDisplayMetadata;
  source?: ToolSourceMetadata;
}): Pick<ToolRuntimeEvent, "id" | "toolName" | "path" | "summary" | "source"> {
  return {
    id: params.id,
    toolName: params.toolName,
    path: params.display.path,
    summary: params.display.summary,
    source: params.source
  };
}

function buildDenialMessage(toolName: string, displayPath: string): string {
  return `User denied approval for ${toolName} on ${displayPath}.`;
}

async function requestUserApproval(params: {
  callbacks: ToolRuntimeCallbacks;
  callId: string;
  toolName: string;
  display: ToolDisplayMetadata;
  source?: ToolSourceMetadata;
  reason?: string;
  emit: (event: ToolRuntimeEvent) => void;
}): Promise<boolean> {
  params.emit({
    id: params.callId,
    toolName: params.toolName,
    path: params.display.path,
    summary: params.display.summary,
    source: params.source,
    status: "awaiting_approval"
  });

  return await params.callbacks.requestApproval({
    id: params.callId,
    toolName: params.toolName,
    path: params.display.path,
    summary: params.display.summary,
    reason: params.reason,
    source: params.source
  });
}

export function createToolRuntime(
  config: BuddyConfig,
  registry: ToolRegistry,
  callbacks: ToolRuntimeCallbacks
): ToolRuntime {
  const workspacePolicyPathPromise = resolvePolicyPath(workspacePath);

  const emit = (event: ToolRuntimeEvent) => {
    callbacks.onEvent?.(event);
  };

  return {
    async executeTool(
      name: string,
      rawArgs: string,
      options?: { callId?: string }
    ): Promise<ToolExecutionResult> {
      const callId = options?.callId ?? name;
      let failureEvent:
        | Pick<ToolRuntimeEvent, "id" | "toolName" | "path" | "summary" | "source">
        | undefined;

      try {
        const tool = registry.getTool(name);
        if (!tool) {
          emit({
            id: callId,
            toolName: name,
            path: name,
            summary: name,
            status: "failed",
            output: `Unknown tool: ${name}`
          });
          return {
            ok: false,
            output: `Unknown tool: ${name}`,
            displayPath: name
          };
        }

        const args = parseArguments(rawArgs);
        let currentDisplay = tool.summarize(args);
        failureEvent = buildFailureEvent({
          id: callId,
          toolName: name,
          display: currentDisplay,
          source: tool.source
        });

        const policyTarget = tool.resolvePolicyPath?.(args);
        if (policyTarget) {
          const workspacePolicyPath = await workspacePolicyPathPromise;
          const policyPath = await resolvePolicyPath(policyTarget);

          if (await isPathBlocked(policyTarget, config.restrictions.blockedDirectories)) {
            emit({
              id: callId,
              toolName: name,
              path: currentDisplay.path,
              summary: currentDisplay.summary,
              source: tool.source,
              status: "failed",
              output: `Blocked by guardrails: ${currentDisplay.path} is inside a blocked directory.`
            });
            return {
              ok: false,
              output: `Blocked by guardrails: ${currentDisplay.path} is inside a blocked directory.`,
              displayPath: currentDisplay.path
            };
          }

          const outsideWorkspace = !isPathInsideDirectory(policyPath, workspacePolicyPath);
          if (config.restrictions.accessLevel === "supervised" && outsideWorkspace) {
            const approved = await requestUserApproval({
              callbacks,
              callId,
              toolName: name,
              display: currentDisplay,
              source: tool.source,
              emit
            });

            if (!approved) {
              const output = buildDenialMessage(name, currentDisplay.path);
              emit({
                id: callId,
                toolName: name,
                path: currentDisplay.path,
                summary: currentDisplay.summary,
                source: tool.source,
                status: "denied",
                output
              });
              return {
                ok: false,
                output,
                displayPath: currentDisplay.path
              };
            }
          }
        }

        if (tool.requiresApproval) {
          const approved = await requestUserApproval({
            callbacks,
            callId,
            toolName: name,
            display: currentDisplay,
            source: tool.source,
            emit
          });

          if (!approved) {
            const output = buildDenialMessage(name, currentDisplay.path);
            emit({
              id: callId,
              toolName: name,
              path: currentDisplay.path,
              summary: currentDisplay.summary,
              source: tool.source,
              status: "denied",
              output
            });
            return {
              ok: false,
              output,
              displayPath: currentDisplay.path
            };
          }
        }

        emit({
          id: callId,
          toolName: name,
          path: currentDisplay.path,
          summary: currentDisplay.summary,
          source: tool.source,
          status: "running"
        });

        let output = await tool.execute(args, { callId });

        while (isBuddyToolDeferredApproval(output)) {
          const summary = output.summary.trim();
          if (!summary) {
            throw new Error(`Tool "${name}" requested approval without a summary.`);
          }

          currentDisplay = {
            path: output.path?.trim() || currentDisplay.path,
            summary
          };
          failureEvent = buildFailureEvent({
            id: callId,
            toolName: name,
            display: currentDisplay,
            source: tool.source
          });

          const approved = await requestUserApproval({
            callbacks,
            callId,
            toolName: name,
            display: currentDisplay,
            source: tool.source,
            reason: output.reason,
            emit
          });

          if (!approved) {
            const deniedOutput = buildDenialMessage(name, currentDisplay.path);
            emit({
              id: callId,
              toolName: name,
              path: currentDisplay.path,
              summary: currentDisplay.summary,
              source: tool.source,
              status: "denied",
              output: deniedOutput
            });
            return {
              ok: false,
              output: deniedOutput,
              displayPath: currentDisplay.path
            };
          }

          emit({
            id: callId,
            toolName: name,
            path: currentDisplay.path,
            summary: currentDisplay.summary,
            source: tool.source,
            status: "running"
          });

          output = await output.continueWith();
        }

        if (typeof output !== "string") {
          throw new Error(`Tool "${name}" returned an invalid output.`);
        }

        emit({
          id: callId,
          toolName: name,
          path: currentDisplay.path,
          summary: currentDisplay.summary,
          source: tool.source,
          status: "completed",
          output
        });

        return {
          ok: true,
          output,
          displayPath: currentDisplay.path
        };
      } catch (error) {
        const message = stringifyError(error);
        if (failureEvent) {
          emit({
            ...failureEvent,
            status: "failed",
            output: message
          });
        }
        return {
          ok: false,
          output: message
        };
      }
    }
  };
}
