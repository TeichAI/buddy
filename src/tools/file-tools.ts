import fs from "node:fs/promises";
import path from "node:path";

export type ToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "create_directory"
  | "list_directory";

export interface ToolContext {
  readSnapshots: Map<string, string>;
}

export interface ReadFileInput {
  path: string;
}

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface EditFileInput {
  path: string;
  newContent: string;
}

export interface DeleteFileInput {
  path: string;
}

export interface CreateDirectoryInput {
  path: string;
}

export interface ListDirectoryInput {
  path: string;
}

export function createToolContext(): ToolContext {
  return {
    readSnapshots: new Map()
  };
}

function buildLineDiff(previous: string, next: string): string {
  const previousLines = previous.split("\n");
  const nextLines = next.split("\n");

  if (previous === next) {
    return "No changes";
  }

  const output: string[] = [];
  const maxLines = Math.max(previousLines.length, nextLines.length);

  for (let index = 0; index < maxLines; index += 1) {
    const before = previousLines[index];
    const after = nextLines[index];

    if (before === after) {
      if (before !== undefined) {
        output.push(` ${before}`);
      }
      continue;
    }

    if (before !== undefined) {
      output.push(`-${before}`);
    }

    if (after !== undefined) {
      output.push(`+${after}`);
    }
  }

  return output.join("\n");
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readFileTool(
  input: ReadFileInput,
  context: ToolContext
): Promise<string> {
  const content = await fs.readFile(input.path, "utf8");
  context.readSnapshots.set(input.path, content);
  return content;
}

export async function writeFileTool(input: WriteFileInput): Promise<string> {
  await ensureParentDir(input.path);
  await fs.writeFile(input.path, input.content, "utf8");
  return `Wrote ${input.path}`;
}

export async function editFileTool(
  input: EditFileInput,
  context: ToolContext
): Promise<string> {
  const previous = context.readSnapshots.get(input.path);
  if (previous === undefined) {
    throw new Error(`edit_file requires read_file first for ${input.path}`);
  }

  await ensureParentDir(input.path);
  await fs.writeFile(input.path, input.newContent, "utf8");
  const diff = buildLineDiff(previous, input.newContent);

  context.readSnapshots.set(input.path, input.newContent);
  return diff;
}

export async function deleteFileTool(input: DeleteFileInput): Promise<string> {
  await fs.rm(input.path, { force: true });
  return `Deleted ${input.path}`;
}

export async function createDirectoryTool(input: CreateDirectoryInput): Promise<string> {
  await fs.mkdir(input.path, { recursive: true });
  return `Created directory ${input.path}`;
}

export async function listDirectoryTool(input: ListDirectoryInput): Promise<string> {
  const entries = await fs.readdir(input.path, { withFileTypes: true });
  const lines = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`);

  return lines.length > 0 ? lines.join("\n") : "(empty directory)";
}
