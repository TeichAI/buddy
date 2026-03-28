import type { Component, SelectItem } from "@mariozechner/pi-tui";
import { SelectList, Text } from "@mariozechner/pi-tui";
import type { ToolSourceMetadata } from "../../tools/registry.js";
import { Frame } from "./frame.js";
import { selectTheme, theme } from "../theme.js";

class ApprovalContent implements Component {
  private readonly list: SelectList;
  private readonly summaryText: Text;

  constructor(params: {
    summary: string;
    onSelect: (value: "approve" | "deny") => void;
    onCancel: () => void;
  }) {
    this.summaryText = new Text(theme.muted(params.summary), 0, 0);
    this.list = new SelectList(
      [
        {
          value: "approve",
          label: "Approve",
          description: "Allow this tool action"
        },
        {
          value: "deny",
          label: "Deny",
          description: "Reject this tool action"
        }
      ] satisfies SelectItem[],
      4,
      selectTheme
    );

    this.list.onSelect = (item) => params.onSelect(item.value as "approve" | "deny");
    this.list.onCancel = params.onCancel;
  }

  invalidate(): void {
    this.summaryText.invalidate();
    this.list.invalidate();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    return [...this.summaryText.render(width), "", ...this.list.render(width)];
  }
}

export class ApprovalDialog implements Component {
  private readonly frame: Frame;

  constructor(params: {
    toolName: string;
    path: string;
    summary: string;
    reason?: string;
    source?: ToolSourceMetadata;
    onSelect: (value: "approve" | "deny") => void;
    onCancel: () => void;
  }) {
    const details = [
      params.summary,
      `Path: ${params.path}`,
      params.source?.kind === "plugin"
        ? `Plugin: ${params.source.pluginName || params.source.pluginId || "plugin"}`
        : undefined,
      params.reason ? `Reason: ${params.reason}` : undefined
    ]
      .filter(Boolean)
      .join("\n\n");

    this.frame = new Frame(
      `Approve ${params.toolName}${params.source?.kind === "plugin" ? " (plugin)" : ""}`,
      new ApprovalContent({
        summary: details,
        onSelect: params.onSelect,
        onCancel: params.onCancel
      }),
      "Buddy needs your approval before this tool action can continue."
    );
  }

  invalidate(): void {
    this.frame.invalidate();
  }

  handleInput(data: string): void {
    this.frame.handleInput(data);
  }

  render(width: number): string[] {
    return this.frame.render(width);
  }
}
