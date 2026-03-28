import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BuddyPlugin, BuddyTool } from "./sdk.js";
import { pluginsPath } from "../utils/paths.js";

interface BuddyPackageMetadata {
  entry: string;
}

interface PluginPackageJson {
  name?: unknown;
  version?: unknown;
  buddy?: BuddyPackageMetadata | unknown;
}

export interface PluginLoadDiagnostic {
  pluginPath: string;
  message: string;
}

export interface LoadedPlugin {
  directoryPath: string;
  manifestName: string;
  manifestVersion: string;
  plugin: BuddyPlugin;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function validateOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireNonEmptyString(value, label);
}

function validateRepositoryUrl(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = requireNonEmptyString(value, "repositoryUrl");
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("repositoryUrl must be an absolute http or https URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("repositoryUrl must use http or https.");
  }

  return parsed.toString();
}

function validateTool(value: unknown, pluginId: string): BuddyTool {
  if (!value || typeof value !== "object") {
    throw new Error(`Plugin "${pluginId}" contains an invalid tool definition.`);
  }

  const tool = value as Partial<BuddyTool>;
  const id = requireNonEmptyString(tool.id, "tool.id");
  const description = requireNonEmptyString(tool.description, `tool "${id}" description`);

  if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) {
    throw new Error(`Tool "${id}" parameters must be an object.`);
  }

  if (typeof tool.summarize !== "function") {
    throw new Error(`Tool "${id}" must provide a summarize(args) function.`);
  }

  if (typeof tool.execute !== "function") {
    throw new Error(`Tool "${id}" must provide an execute(context, args) function.`);
  }

  if (tool.requiresApproval !== undefined && typeof tool.requiresApproval !== "boolean") {
    throw new Error(`Tool "${id}" requiresApproval must be a boolean when provided.`);
  }

  return {
    id,
    description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
    summarize: tool.summarize,
    execute: tool.execute
  };
}

function validatePlugin(value: unknown, manifestName: string, manifestVersion: string): BuddyPlugin {
  if (!value || typeof value !== "object") {
    throw new Error("Plugin entrypoint must default export a plugin object.");
  }

  const plugin = value as Partial<BuddyPlugin>;
  const id = requireNonEmptyString(plugin.id, "plugin.id");

  if (!Array.isArray(plugin.tools)) {
    throw new Error(`Plugin "${id}" must export a tools array.`);
  }

  const validatedTools = plugin.tools.map((tool) => validateTool(tool, id));
  const seenToolIds = new Set<string>();

  for (const tool of validatedTools) {
    if (seenToolIds.has(tool.id)) {
      throw new Error(`Plugin "${id}" defines duplicate tool id "${tool.id}".`);
    }
    seenToolIds.add(tool.id);
  }

  return {
    id,
    name: validateOptionalString(plugin.name, "plugin.name") ?? manifestName,
    version: validateOptionalString(plugin.version, "plugin.version") ?? manifestVersion,
    description: validateOptionalString(plugin.description, "plugin.description"),
    author: validateOptionalString(plugin.author, "plugin.author"),
    repositoryUrl: validateRepositoryUrl(plugin.repositoryUrl),
    tools: validatedTools
  };
}

async function readPluginPackage(pluginDirectory: string): Promise<{
  manifestName: string;
  manifestVersion: string;
  entryPath: string;
}> {
  const packageJsonPath = path.join(pluginDirectory, "package.json");
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as PluginPackageJson;
  const manifestName = requireNonEmptyString(parsed.name, "package.json name");
  const manifestVersion = requireNonEmptyString(parsed.version, "package.json version");

  if (!parsed.buddy || typeof parsed.buddy !== "object" || Array.isArray(parsed.buddy)) {
    throw new Error("package.json must contain a buddy object.");
  }

  const entry = requireNonEmptyString((parsed.buddy as BuddyPackageMetadata).entry, "package.json buddy.entry");
  return {
    manifestName,
    manifestVersion,
    entryPath: path.resolve(pluginDirectory, entry)
  };
}

async function importPlugin(entryPath: string): Promise<unknown> {
  const stat = await fs.stat(entryPath);
  const moduleUrl = `${pathToFileURL(entryPath).href}?mtime=${stat.mtimeMs}`;
  const loaded = (await import(moduleUrl)) as { default?: unknown };
  return loaded.default;
}

export async function loadPlugins(
  pluginDirectoryPath: string = pluginsPath
): Promise<{ plugins: LoadedPlugin[]; diagnostics: PluginLoadDiagnostic[] }> {
  let directoryEntries;

  try {
    directoryEntries = await fs.readdir(pluginDirectoryPath, { withFileTypes: true });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        plugins: [],
        diagnostics: []
      };
    }

    throw error;
  }

  const diagnostics: PluginLoadDiagnostic[] = [];
  const loadedPlugins: LoadedPlugin[] = [];
  const seenPluginIds = new Set<string>();

  for (const entry of directoryEntries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const pluginPath = path.join(pluginDirectoryPath, entry.name);

    try {
      const { manifestName, manifestVersion, entryPath } = await readPluginPackage(pluginPath);
      const plugin = validatePlugin(await importPlugin(entryPath), manifestName, manifestVersion);

      if (seenPluginIds.has(plugin.id)) {
        diagnostics.push({
          pluginPath,
          message: `Duplicate plugin id "${plugin.id}".`
        });
        continue;
      }

      seenPluginIds.add(plugin.id);
      loadedPlugins.push({
        directoryPath: pluginPath,
        manifestName,
        manifestVersion,
        plugin
      });
    } catch (error) {
      diagnostics.push({
        pluginPath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    plugins: loadedPlugins,
    diagnostics
  };
}
