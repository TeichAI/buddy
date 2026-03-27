import type { Component, SelectItem } from "@mariozechner/pi-tui";
import { getKeybindings, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { Frame } from "./frame.js";
import { theme } from "../theme.js";

const ACTION_ITEMS = [{ id: "delete", label: "Delete chat" }] as const;
const DESCRIPTION_BREAKPOINT = 40;
const MAX_PRIMARY_WIDTH = 32;
const PRIMARY_GAP = 2;

function normalizeSingleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export class ConversationSelectDialog implements Component {
  private readonly frame: Frame;
  private items: SelectItem[];
  private selectedIndex = 0;
  private actionsOpen = false;
  private selectedActionIndex = 0;

  constructor(params: {
    title: string;
    subtitle?: string;
    items: SelectItem[];
    onSelect: (item: SelectItem) => void;
    onDelete: (item: SelectItem) => void;
    onCancel: () => void;
    maxVisible?: number;
  }) {
    this.items = params.items;
    this.frame = new Frame(params.title, this, params.subtitle);
    this.onSelect = params.onSelect;
    this.onDelete = params.onDelete;
    this.onCancel = params.onCancel;
    this.maxVisible = params.maxVisible ?? 10;
  }

  private readonly onSelect: (item: SelectItem) => void;
  private readonly onDelete: (item: SelectItem) => void;
  private readonly onCancel: () => void;
  private readonly maxVisible: number;

  setItems(items: SelectItem[]): void {
    this.items = items;
    this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, items.length - 1));
    this.actionsOpen = false;
    this.selectedActionIndex = 0;
  }

  invalidate(): void {
    this.frame.invalidate();
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.actionsOpen) {
        this.actionsOpen = false;
        this.selectedActionIndex = 0;
        return;
      }
      this.onCancel();
      return;
    }

    if (this.items.length === 0) {
      return;
    }

    if (kb.matches(data, "tui.input.tab") || matchesKey(data, "shift+tab")) {
      this.actionsOpen = !this.actionsOpen;
      this.selectedActionIndex = 0;
      return;
    }

    if (this.actionsOpen) {
      if (kb.matches(data, "tui.select.confirm")) {
        const item = this.items[this.selectedIndex];
        if (!item) {
          return;
        }

        const action = ACTION_ITEMS[this.selectedActionIndex];
        if (action?.id === "delete") {
          this.onDelete(item);
        }
      }
      return;
    }

    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex = this.selectedIndex === 0 ? this.items.length - 1 : this.selectedIndex - 1;
      return;
    }

    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex = this.selectedIndex === this.items.length - 1 ? 0 : this.selectedIndex + 1;
      return;
    }

    if (kb.matches(data, "tui.select.confirm")) {
      const item = this.items[this.selectedIndex];
      if (item) {
        this.onSelect(item);
      }
    }
  }

  render(width: number): string[] {
    return this.frame.render(width);
  }

  private getPrimaryColumnWidth(): number {
    const widestPrimary = this.items.reduce((widest, item) => {
      const value = item.label || item.value;
      return Math.max(widest, visibleWidth(value) + PRIMARY_GAP);
    }, 0);

    return clamp(widestPrimary, 1, MAX_PRIMARY_WIDTH);
  }

  private renderItem(item: SelectItem, isSelected: boolean, width: number, primaryColumnWidth: number): string {
    const prefix = isSelected ? "→ " : "  ";
    const prefixWidth = visibleWidth(prefix);
    const value = item.label || item.value;
    const description = item.description ? normalizeSingleLine(item.description) : "";

    if (description && width > DESCRIPTION_BREAKPOINT) {
      const effectivePrimaryWidth = Math.max(1, Math.min(primaryColumnWidth, width - prefixWidth - 4));
      const truncatedValue = truncateToWidth(value, Math.max(1, effectivePrimaryWidth - PRIMARY_GAP), "");
      const valueWidth = visibleWidth(truncatedValue);
      const spacing = " ".repeat(Math.max(1, effectivePrimaryWidth - valueWidth));
      const remainingWidth = width - prefixWidth - valueWidth - spacing.length - 2;

      if (remainingWidth > 10) {
        const truncatedDescription = truncateToWidth(description, remainingWidth, "");
        if (isSelected) {
          return chalk.bold(theme.accent(`${prefix}${truncatedValue}${spacing}`)) + theme.muted(truncatedDescription);
        }
        return prefix + truncatedValue + theme.muted(`${spacing}${truncatedDescription}`);
      }
    }

    const truncatedValue = truncateToWidth(value, Math.max(1, width - prefixWidth - 2), "");
    return isSelected ? chalk.bold(theme.accent(`${prefix}${truncatedValue}`)) : `${prefix}${truncatedValue}`;
  }

  private renderAction(width: number): string {
    const action = ACTION_ITEMS[this.selectedActionIndex];
    const prefix = "   ↳ ";
    const text = `${prefix}${action?.label ?? ""}`;
    return truncateToWidth(chalk.bold(theme.accentStrong(text)), width, "");
  }

  renderInner(width: number): string[] {
    if (this.items.length === 0) {
      return [theme.muted("  No saved chats"), "", theme.muted("  Esc to cancel")];
    }

    const lines: string[] = [];
    const primaryColumnWidth = this.getPrimaryColumnWidth();
    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.items.length - this.maxVisible)
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.items.length);

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = this.items[index];
      if (!item) {
        continue;
      }

      const isSelected = index === this.selectedIndex;
      lines.push(this.renderItem(item, isSelected, width, primaryColumnWidth));
      if (isSelected && this.actionsOpen) {
        lines.push(this.renderAction(width));
      }
    }

    if (startIndex > 0 || endIndex < this.items.length) {
      lines.push(theme.muted(truncateToWidth(`  (${this.selectedIndex + 1}/${this.items.length})`, width - 2, "")));
    }

    lines.push("");
    lines.push(
      theme.muted(
        truncateToWidth(
          this.actionsOpen
            ? "  Enter delete · Tab close actions · Esc close actions"
            : "  Enter open chat · Tab chat actions · Esc cancel",
          width,
          ""
        )
      )
    );
    return lines;
  }
}
