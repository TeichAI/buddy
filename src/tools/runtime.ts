import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BuddyConfig } from "../config/schema.js";
import { workspacePath } from "../utils/paths.js";
import {
  createDirectoryTool,
  createToolContext,
  deleteFileTool,
  editFileTool,
  listDirectoryTool,
  readFileTool,
  type ToolContext,
  writeFileTool
} from "./file-tools.js";
import { webSearchTool } from "./web-search.js";

export interface ToolApprovalRequest {
  id: string;
  toolName: string;
  path: string;
  summary: string;
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

interface ResolvedPolicy {
  resolvedPath: string;
  displayPath: string;
}

const pathToolNames = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "create_directory",
  "list_directory"
]);

function isPathToolName(name: string): boolean {
  return pathToolNames.has(name);
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function normalizeDir(dirPath: string): string {
  return path.resolve(expandHome(dirPath));
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const target = path.resolve(targetPath);
  const directory = path.resolve(directoryPath);
  return target === directory || target.startsWith(`${directory}${path.sep}`);
}

async function resolvePolicyPath(targetPath: string): Promise<string> {
  const absoluteTarget = path.resolve(targetPath);
  const missingSegments: string[] = [];
  let currentPath = absoluteTarget;

  while (true) {
    try {
      const resolvedExistingPath = await fs.realpath(currentPath);
      return missingSegments.length > 0
        ? path.join(resolvedExistingPath, ...missingSegments.reverse())
        : resolvedExistingPath;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return absoluteTarget;
      }

      missingSegments.push(path.basename(currentPath));
      currentPath = parentPath;
    }
  }
}

async function isPathBlocked(filePath: string, blockedDirectories: string[]): Promise<boolean> {
  const target = await resolvePolicyPath(filePath);
  const normalizedBlockedDirectories = await Promise.all(
    blockedDirectories.map(async (blockedDir) => resolvePolicyPath(normalizeDir(blockedDir)))
  );

  return normalizedBlockedDirectories.some((blockedDir) => isPathInsideDirectory(target, blockedDir));
}

function resolveToolPath(inputPath: string): ResolvedPolicy {
  const expanded = expandHome(inputPath.trim());
  const resolvedPath = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspacePath, expanded);

  return {
    resolvedPath,
    displayPath: inputPath.trim() || resolvedPath
  };
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArguments(rawArgs: string): Record<string, unknown> {
  try {
    return JSON.parse(rawArgs) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid tool arguments: ${stringifyError(error)}`);
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tool argument "${key}" must be a non-empty string.`);
  }
  return value;
}

function summarizeMutation(toolName: string, displayPath: string, args: Record<string, unknown>): string {
  if (toolName === "read_file") {
    return `Read ${displayPath}`;
  }

  if (toolName === "write_file") {
    const content = typeof args.content === "string" ? args.content : "";
    return `Write ${content.length} chars to ${displayPath}`;
  }

  if (toolName === "edit_file") {
    const content = typeof args.newContent === "string" ? args.newContent : "";
    return `Edit ${displayPath} with ${content.length} chars`;
  }

  if (toolName === "delete_file") {
    return `Delete ${displayPath}`;
  }

  if (toolName === "create_directory") {
    return `Create directory ${displayPath}`;
  }

  if (toolName === "list_directory") {
    return `List ${displayPath}`;
  }

  if (toolName === "web_search") {
    const query = typeof args.query === "string" ? args.query : displayPath;
    return `Search the web for ${query}`;
  }

  return `${toolName} on ${displayPath}`;
}

export function createToolRuntime(
  config: BuddyConfig,
  callbacks: ToolRuntimeCallbacks,
  context: ToolContext = createToolContext()
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
      let failureEvent:
        | Pick<ToolRuntimeEvent, "id" | "toolName" | "path" | "summary">
        | undefined;

      try {
        const args = parseArguments(rawArgs);
        let resolvedPath: string | undefined;
        let displayPath: string;

        if (isPathToolName(name)) {
          const rawPath = requireString(args, "path");
          const resolved = resolveToolPath(rawPath);
          resolvedPath = resolved.resolvedPath;
          displayPath = resolved.displayPath;
        } else if (name === "web_search") {
          const query = requireString(args, "query");
          displayPath = `search: ${query}`;
        } else {
          displayPath = name;
        }

        const callId = options?.callId ?? `${name}:${displayPath}`;
        const summary = summarizeMutation(name, displayPath, args);
        failureEvent = { id: callId, toolName: name, path: displayPath, summary };

        if (resolvedPath) {
          const workspacePolicyPath = await workspacePolicyPathPromise;
          const policyPath = await resolvePolicyPath(resolvedPath);

          if (await isPathBlocked(resolvedPath, config.restrictions.blockedDirectories)) {
            emit({
              id: callId,
              toolName: name,
              path: displayPath,
              summary,
              status: "failed",
              output: `Blocked by guardrails: ${displayPath} is inside a blocked directory.`
            });
            return {
              ok: false,
              output: `Blocked by guardrails: ${displayPath} is inside a blocked directory.`,
              displayPath
            };
          }

          const outsideWorkspace = !isPathInsideDirectory(policyPath, workspacePolicyPath);

          if (config.restrictions.accessLevel === "supervised" && outsideWorkspace) {
            emit({
              id: callId,
              toolName: name,
              path: displayPath,
              summary,
              status: "awaiting_approval"
            });

            const approved = await callbacks.requestApproval({
              id: callId,
              toolName: name,
              path: displayPath,
              summary
            });

            if (!approved) {
              emit({
                id: callId,
                toolName: name,
                path: displayPath,
                summary,
                status: "denied",
                output: `User denied approval for ${name} on ${displayPath}.`
              });
              return {
                ok: false,
                output: `User denied approval for ${name} on ${displayPath}.`,
                displayPath
              };
            }
          }
        }

        if (name === "web_search" && !config.tools.webSearch.enabled) {
          emit({
            id: callId,
            toolName: name,
            path: displayPath,
            summary,
            status: "failed",
            output: "Web search is disabled in buddy config."
          });
          return {
            ok: false,
            output: "Web search is disabled in buddy config.",
            displayPath
          };
        }

        emit({
          id: callId,
          toolName: name,
          path: displayPath,
          summary,
          status: "running"
        });

        if (name === "read_file") {
          const output = await readFileTool({ path: resolvedPath! }, context);
          emit({ id: callId, toolName: name, path: displayPath, summary, status: "completed", output });
          return { ok: true, output, displayPath };
        }

        if (name === "list_directory") {
          const output = await listDirectoryTool({ path: resolvedPath! });
          emit({ id: callId, toolName: name, path: displayPath, summary, status: "completed", output });
          return { ok: true, output, displayPath };
        }

        if (name === "write_file") {
          const content = requireString(args, "content");
          const output = await writeFileTool({ path: resolvedPath!, content });
          emit({ id: callId, toolName: name, path: displayPath, summary, status: "completed", output });
          return { ok: true, output, displayPath };
        }

        if (name === "edit_file") {
          const newContent = requireString(args, "newContent");
          const output = await editFileTool({ path: resolvedPath!, newContent }, context);
          emit({ id: callId, toolName: name, path: displayPath, summary, status: "completed", output });
          return { ok: true, output, displayPath };
        }

        if (name === "delete_file") {
          const output = await deleteFileTool({ path: resolvedPath! });
          emit({ id: callId, toolName: name, path: displayPath, summary, status: "completed", output });
          return { ok: true, output, displayPath };
        }

        if (name === "create_directory") {
          const output = await createDirectoryTool({ path: resolvedPath! });
          emit({ id: callId, toolName: name, path: displayPath, summary, status: "completed", output });
          return { ok: true, output, displayPath };
        }

        if (name === "web_search") {
          const query = requireString(args, "query");
          const output = await webSearchTool(query);
          emit({ id: callId, toolName: name, path: displayPath, summary, status: "completed", output });
          return { ok: true, output, displayPath };
        }

        emit({
          id: callId,
          toolName: name,
          path: displayPath,
          summary,
          status: "failed",
          output: `Unknown tool: ${name}`
        });
        return {
          ok: false,
          output: `Unknown tool: ${name}`,
          displayPath
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
