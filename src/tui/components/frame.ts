import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export class Frame implements Component {
  constructor(
    private readonly title: string,
    private readonly child: Component,
    private readonly subtitle?: string
  ) {}

  invalidate(): void {
    this.child.invalidate();
  }

  handleInput(data: string): void {
    this.child.handleInput?.(data);
  }

  render(width: number): string[] {
    const innerWidth = Math.max(16, width - 4);
    const title = theme.title(` ${this.title} `);
    const topBorder = `┌${title}${"─".repeat(Math.max(0, innerWidth - visibleWidth(this.title) - 1))}┐`;
    const childWithOptionalRenderInner = this.child as Component & { renderInner?: (width: number) => string[] };
    const childRender =
      typeof childWithOptionalRenderInner.renderInner === "function"
        ? childWithOptionalRenderInner.renderInner(innerWidth)
        : this.child.render(innerWidth);
    const childLines = childRender.slice(0, Math.max(1, innerWidth * 4));
    const body = childLines.map((line) => `│ ${line.padEnd(innerWidth)} │`);
    const subtitleText = this.subtitle ? this.subtitle.padEnd(innerWidth) : undefined;
    const subtitleLine = this.subtitle
      ? `│ ${theme.muted(subtitleText ?? "")} │`
      : undefined;

    return [
      topBorder,
      ...(subtitleLine ? [subtitleLine, `│ ${"".padEnd(innerWidth)} │`] : []),
      ...body,
      `└${"─".repeat(innerWidth + 2)}┘`
    ];
  }
}
