import path from "node:path";
import { Container, Text } from "@mariozechner/pi-tui";
import type { ToolSourceMetadata } from "../../tools/registry.js";
import { theme } from "../theme.js";
import { workspacePath } from "../../utils/paths.js";

export type ToolCardStatus = "running" | "awaiting_approval" | "completed" | "denied" | "failed";

function statusLabel(status: ToolCardStatus): string {
  if (status === "running") {
    return "Running";
  }

  if (status === "awaiting_approval") {
    return "Needs approval";
  }

  if (status === "completed") {
    return "Done";
  }

  if (status === "denied") {
    return "Denied";
  }

  return "Failed";
}

function compactPath(rawPath: string): string {
  if (rawPath.startsWith(workspacePath)) {
    const relative = path.relative(workspacePath, rawPath);
    return relative ? `workspace/${relative}` : "workspace";
  }

  return rawPath;
}

function previewOutput(status: ToolCardStatus, output?: string): string {
  if (!output) {
    return "";
  }

  if (status === "completed") {
    const lines = output.split("\n").filter(Boolean);

    if (lines.length === 0) {
      return "";
    }

    if (lines[0] === "(empty directory)") {
      return lines[0];
    }

    if (lines.every((line) => line.startsWith("[dir] ") || line.startsWith("[file] "))) {
      const preview = lines.slice(0, 3).join("   ·   ");
      const extra = lines.length > 3 ? `   ·   +${lines.length - 3} more` : "";
      return `${preview}${extra}`;
    }

    return "";
  }

  const collapsed = output.replaceAll("\n", " ").trim();
  return collapsed.length > 140 ? `${collapsed.slice(0, 137)}...` : collapsed;
}

function sourceLabel(source?: ToolSourceMetadata): string {
  if (source?.kind !== "plugin") {
    return "";
  }

  return source.pluginName || source.pluginId || "plugin";
}

export class ToolCard extends Container {
  private readonly titleText: Text;
  private readonly pathText: Text;
  private readonly outputText: Text;

  constructor(params: {
    toolName: string;
    path: string;
    summary: string;
    status: ToolCardStatus;
    output?: string;
    source?: ToolSourceMetadata;
  }) {
    super();
    this.titleText = new Text("", 0, 0);
    this.pathText = new Text("", 0, 0);
    this.outputText = new Text("", 0, 0);
    this.addChild(this.titleText);
    this.addChild(this.pathText);
    this.addChild(this.outputText);
    this.update(params);
  }

  update(params: {
    toolName: string;
    path: string;
    summary: string;
    status: ToolCardStatus;
    output?: string;
    source?: ToolSourceMetadata;
  }): void {
    const statusColor =
      params.status === "completed"
        ? theme.success
        : params.status === "denied" || params.status === "failed"
          ? theme.error
          : theme.accent;

    const source = sourceLabel(params.source);
    this.titleText.setText(statusColor(`• ${statusLabel(params.status)}`) + theme.text(` ${params.summary}`));
    this.pathText.setText(
      theme.muted(`  └ ${compactPath(params.path)}${source ? `   ·   plugin ${source}` : ""}`)
    );

    const preview = previewOutput(params.status, params.output);
    this.outputText.setText(preview ? theme.muted(`    ${preview}`) : "");
  }
}
