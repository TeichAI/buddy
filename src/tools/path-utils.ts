import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workspacePath } from "../utils/paths.js";

export interface ResolvedToolPath {
  resolvedPath: string;
  displayPath: string;
}

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function normalizeDir(dirPath: string): string {
  return path.resolve(expandHome(dirPath));
}

export function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const target = path.resolve(targetPath);
  const directory = path.resolve(directoryPath);
  return target === directory || target.startsWith(`${directory}${path.sep}`);
}

export async function resolvePolicyPath(targetPath: string): Promise<string> {
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

export async function isPathBlocked(filePath: string, blockedDirectories: string[]): Promise<boolean> {
  const target = await resolvePolicyPath(filePath);
  const normalizedBlockedDirectories = await Promise.all(
    blockedDirectories.map(async (blockedDir) => resolvePolicyPath(normalizeDir(blockedDir)))
  );

  return normalizedBlockedDirectories.some((blockedDir) => isPathInsideDirectory(target, blockedDir));
}

export function resolveToolPath(inputPath: string): ResolvedToolPath {
  const expanded = expandHome(inputPath.trim());
  const resolvedPath = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspacePath, expanded);

  return {
    resolvedPath,
    displayPath: inputPath.trim() || resolvedPath
  };
}
