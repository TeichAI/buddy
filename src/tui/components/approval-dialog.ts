import type { Component, SelectItem } from "@mariozechner/pi-tui";
import { SelectList, Text } from "@mariozechner/pi-tui";
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
    onSelect: (value: "approve" | "deny") => void;
    onCancel: () => void;
  }) {
    this.frame = new Frame(
      `Approve ${params.toolName}`,
      new ApprovalContent({
        summary: `${params.summary}\n\nPath: ${params.path}`,
        onSelect: params.onSelect,
        onCancel: params.onCancel
      }),
      "Supervised mode requires approval for mutating tool calls."
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
