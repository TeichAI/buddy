import type { Component, SelectItem } from "@mariozechner/pi-tui";
import { SelectList } from "@mariozechner/pi-tui";
import { Frame } from "./frame.js";
import { selectTheme } from "../theme.js";

export class SelectDialog implements Component {
  private readonly frame: Frame;
  private readonly list: SelectList;

  constructor(params: {
    title: string;
    subtitle?: string;
    items: SelectItem[];
    onSelect: (item: SelectItem) => void;
    onCancel: () => void;
  }) {
    this.list = new SelectList(params.items, 10, selectTheme);
    this.list.onSelect = params.onSelect;
    this.list.onCancel = params.onCancel;
    this.frame = new Frame(params.title, this.list, params.subtitle);
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
