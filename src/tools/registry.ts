import type { BuddyConfig } from "../config/schema.js";
import { buddyHome, pluginsPath, workspacePath } from "../utils/paths.js";
import {
  createDirectoryTool,
  deleteFileTool,
  editFileTool,
  listDirectoryTool,
  readFileTool,
  type ToolContext,
  writeFileTool
} from "./file-tools.js";
import { resolveToolPath } from "./path-utils.js";
import { webSearchTool } from "./web-search.js";
import {
  isBuddyToolDeferredApproval,
  type BuddyJsonSchema,
  type BuddyPlugin,
  type BuddyToolDeferredApproval,
  type BuddyToolDisplay
} from "../plugins/sdk.js";
import {
  loadPlugins,
  type LoadedPlugin,
  type PluginLoadDiagnostic
} from "../plugins/loader.js";

export interface ToolSourceMetadata {
  kind: "builtin" | "plugin";
  pluginId?: string;
  pluginName?: string;
  version?: string;
  author?: string;
  repositoryUrl?: string;
}

export interface ToolDisplayMetadata {
  summary: string;
  path: string;
}

export interface ToolExecutionContext {
  callId: string;
}

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: BuddyJsonSchema;
  requiresApproval: boolean;
  source: ToolSourceMetadata;
  summarize: (args: Record<string, unknown>) => ToolDisplayMetadata;
  resolvePolicyPath?: (args: Record<string, unknown>) => string;
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<string | BuddyToolDeferredApproval<string>>;
}

export interface ToolRegistry {
  diagnostics: PluginLoadDiagnostic[];
  definitions: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: BuddyJsonSchema;
    };
  }>;
  promptLines: string[];
  getTool(name: string): RegisteredTool | undefined;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tool argument "${key}" must be a non-empty string.`);
  }

  return value;
}

function normalizeToolDisplay(display: BuddyToolDisplay | string, fallbackPath: string): ToolDisplayMetadata {
  if (typeof display === "string") {
    const summary = display.trim();
    if (!summary) {
      throw new Error("Tool summary must be a non-empty string.");
    }

    return {
      summary,
      path: fallbackPath
    };
  }

  if (!display || typeof display !== "object") {
    throw new Error("Tool summarize(args) must return a string or { summary, path? }.");
  }

  const summary = typeof display.summary === "string" ? display.summary.trim() : "";
  if (!summary) {
    throw new Error("Tool summarize(args) must return a non-empty summary.");
  }

  const path = typeof display.path === "string" && display.path.trim() ? display.path.trim() : fallbackPath;
  return { summary, path };
}

function normalizePluginToolName(pluginId: string, toolId: string): string {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool";

  return `${normalize(pluginId)}__${normalize(toolId)}`;
}

function createBuiltInTools(config: BuddyConfig, context: ToolContext): RegisteredTool[] {
  const tools: RegisteredTool[] = [
    {
      name: "read_file",
      description: "Read a text file from disk before making edits or answering questions about it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to read." }
        },
        required: ["path"],
        additionalProperties: false
      },
      requiresApproval: false,
      source: { kind: "builtin" },
      summarize: (args) => {
        const rawPath = requireString(args, "path");
        const resolved = resolveToolPath(rawPath);
        return {
          path: resolved.displayPath,
          summary: `Read ${resolved.displayPath}`
        };
      },
      resolvePolicyPath: (args) => resolveToolPath(requireString(args, "path")).resolvedPath,
      execute: async (args) => await readFileTool({ path: resolveToolPath(requireString(args, "path")).resolvedPath }, context)
    },
    {
      name: "list_directory",
      description: "List directory contents so you can discover files and folders before reading or editing them.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to inspect." }
        },
        required: ["path"],
        additionalProperties: false
      },
      requiresApproval: false,
      source: { kind: "builtin" },
      summarize: (args) => {
        const rawPath = requireString(args, "path");
        const resolved = resolveToolPath(rawPath);
        return {
          path: resolved.displayPath,
          summary: `List ${resolved.displayPath}`
        };
      },
      resolvePolicyPath: (args) => resolveToolPath(requireString(args, "path")).resolvedPath,
      execute: async (args) =>
        await listDirectoryTool({ path: resolveToolPath(requireString(args, "path")).resolvedPath })
    },
    {
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
      },
      requiresApproval: false,
      source: { kind: "builtin" },
      summarize: (args) => {
        const rawPath = requireString(args, "path");
        const resolved = resolveToolPath(rawPath);
        const content = typeof args.content === "string" ? args.content : "";
        return {
          path: resolved.displayPath,
          summary: `Write ${content.length} chars to ${resolved.displayPath}`
        };
      },
      resolvePolicyPath: (args) => resolveToolPath(requireString(args, "path")).resolvedPath,
      execute: async (args) => {
        const content = requireString(args, "content");
        return await writeFileTool(
          { path: resolveToolPath(requireString(args, "path")).resolvedPath, content }
        );
      }
    },
    {
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
      },
      requiresApproval: false,
      source: { kind: "builtin" },
      summarize: (args) => {
        const rawPath = requireString(args, "path");
        const resolved = resolveToolPath(rawPath);
        const content = typeof args.newContent === "string" ? args.newContent : "";
        return {
          path: resolved.displayPath,
          summary: `Edit ${resolved.displayPath} with ${content.length} chars`
        };
      },
      resolvePolicyPath: (args) => resolveToolPath(requireString(args, "path")).resolvedPath,
      execute: async (args) => {
        const newContent = requireString(args, "newContent");
        return await editFileTool(
          { path: resolveToolPath(requireString(args, "path")).resolvedPath, newContent },
          context
        );
      }
    },
    {
      name: "delete_file",
      description: "Delete a file from disk.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to delete." }
        },
        required: ["path"],
        additionalProperties: false
      },
      requiresApproval: false,
      source: { kind: "builtin" },
      summarize: (args) => {
        const rawPath = requireString(args, "path");
        const resolved = resolveToolPath(rawPath);
        return {
          path: resolved.displayPath,
          summary: `Delete ${resolved.displayPath}`
        };
      },
      resolvePolicyPath: (args) => resolveToolPath(requireString(args, "path")).resolvedPath,
      execute: async (args) =>
        await deleteFileTool({ path: resolveToolPath(requireString(args, "path")).resolvedPath })
    },
    {
      name: "create_directory",
      description: "Create a directory. Relative paths are resolved inside the workspace by default.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to create." }
        },
        required: ["path"],
        additionalProperties: false
      },
      requiresApproval: false,
      source: { kind: "builtin" },
      summarize: (args) => {
        const rawPath = requireString(args, "path");
        const resolved = resolveToolPath(rawPath);
        return {
          path: resolved.displayPath,
          summary: `Create directory ${resolved.displayPath}`
        };
      },
      resolvePolicyPath: (args) => resolveToolPath(requireString(args, "path")).resolvedPath,
      execute: async (args) =>
        await createDirectoryTool({ path: resolveToolPath(requireString(args, "path")).resolvedPath })
    }
  ];

  if (config.tools.webSearch.enabled) {
    tools.push({
      name: "web_search",
      description:
        "Search the web with DuckDuckGo HTML, then fetch and return readable text from the top 3 result pages.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query to run on the web." }
        },
        required: ["query"],
        additionalProperties: false
      },
      requiresApproval: false,
      source: { kind: "builtin" },
      summarize: (args) => {
        const query = requireString(args, "query");
        return {
          path: `search: ${query}`,
          summary: `Search the web for ${query}`
        };
      },
      execute: async (args) => await webSearchTool(requireString(args, "query"))
    });
  }

  return tools;
}

function createPluginTools(
  loadedPlugins: LoadedPlugin[],
  diagnostics: PluginLoadDiagnostic[]
): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const seenToolNames = new Set<string>();

  for (const loadedPlugin of loadedPlugins) {
    const plugin = loadedPlugin.plugin;
    for (const tool of plugin.tools) {
      const name = normalizePluginToolName(plugin.id, tool.id);
      if (seenToolNames.has(name)) {
        diagnostics.push({
          pluginPath: loadedPlugin.directoryPath,
          message: `Tool "${tool.id}" collides with another registered tool name as "${name}".`
        });
        continue;
      }

      seenToolNames.add(name);

      tools.push({
        name,
        description: tool.description,
        parameters: tool.parameters,
        requiresApproval: tool.requiresApproval === true,
        source: {
          kind: "plugin",
          pluginId: plugin.id,
          pluginName: plugin.name,
          version: plugin.version,
          author: plugin.author,
          repositoryUrl: plugin.repositoryUrl
        },
        summarize: (args) => normalizePluginToolDisplay(tool, args, name),
        execute: async (args, context) => {
          const result = await tool.execute(
            {
              buddyHome,
              workspacePath,
              callId: context.callId,
              pluginId: plugin.id,
              toolId: tool.id,
              toolName: name
            },
            args
          );

          if (isBuddyToolDeferredApproval(result)) {
            return result;
          }

          if (typeof result !== "string") {
            throw new Error(`Plugin tool "${plugin.id}/${tool.id}" must return a string output.`);
          }

          return result;
        }
      });
    }
  }

  return tools;
}

function normalizePluginToolDisplay(
  tool: BuddyPlugin["tools"][number],
  args: Record<string, unknown>,
  fallbackPath: string
): ToolDisplayMetadata {
  return normalizeToolDisplay(tool.summarize(args), fallbackPath);
}

export async function createToolRegistry(
  config: BuddyConfig,
  context: ToolContext,
  options?: { pluginDirectory?: string }
): Promise<ToolRegistry> {
  const { plugins, diagnostics } = await loadPlugins(options?.pluginDirectory ?? pluginsPath);
  const builtIns = createBuiltInTools(config, context);
  const pluginTools = createPluginTools(plugins, diagnostics);
  const tools = [...builtIns];
  const seenNames = new Set(builtIns.map((tool) => tool.name));

  for (const tool of pluginTools) {
    if (seenNames.has(tool.name)) {
      diagnostics.push({
        pluginPath: tool.source.pluginId ?? "plugin",
        message: `Tool name "${tool.name}" collides with an existing tool.`
      });
      continue;
    }

    seenNames.add(tool.name);
    tools.push(tool);
  }

  const definitions = tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

  const promptLines = tools.map((tool) => `- \`${tool.name}\`: ${tool.description}`);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool] as const));

  return {
    diagnostics,
    definitions,
    promptLines,
    getTool(name: string): RegisteredTool | undefined {
      return toolMap.get(name);
    }
  };
}
