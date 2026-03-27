import type { Component } from "@mariozechner/pi-tui";
import { Box, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { markdownTheme, theme } from "../theme.js";
import { ToolCard, type ToolCardStatus } from "./tool-card.js";

class UserMessage extends Container {
  constructor(author: string, text: string) {
    super();
    this.addChild(new Text(theme.heading(author), 0, 0));

    const bubble = new Box(1, 0, theme.userPanel);
    bubble.addChild(new Text(text, 0, 0));
    this.addChild(bubble);
  }
}

class AssistantMessage extends Container {
  private readonly body: Markdown;

  constructor(author: string, text: string) {
    super();
    this.addChild(new Text(theme.title(author), 0, 0));
    this.body = new Markdown(text, 0, 0, markdownTheme);
    this.addChild(this.body);
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}

export class ChatLog extends Container {
  private readonly maxComponents: number;
  private readonly streamingMessages = new Map<string, AssistantMessage>();
  private readonly toolCards = new Map<string, ToolCard>();

  constructor(maxComponents = 200) {
    super();
    this.maxComponents = maxComponents;
  }

  private append(component: Component): void {
    if (this.children.length > 0) {
      this.addChild(new Spacer(1));
    }

    this.addChild(component);

    while (this.children.length > this.maxComponents) {
      const oldest = this.children[0];
      if (!oldest) {
        return;
      }
      this.removeChild(oldest);
    }
  }

  clearMessages(): void {
    this.clear();
    this.streamingMessages.clear();
    this.toolCards.clear();
  }

  isEmpty(): boolean {
    return this.children.length === 0;
  }

  addSystem(text: string): void {
    this.append(new Text(theme.muted(text), 0, 0));
  }

  addUser(author: string, text: string): void {
    this.append(new UserMessage(author, text));
  }

  addAssistant(author: string, text: string): void {
    this.append(new AssistantMessage(author, text));
  }

  upsertTool(params: {
    id: string;
    toolName: string;
    path: string;
    summary: string;
    status: ToolCardStatus;
    output?: string;
  }): void {
    const existing = this.toolCards.get(params.id);
    if (existing) {
      existing.update(params);
      return;
    }

    const card = new ToolCard(params);
    this.toolCards.set(params.id, card);
    this.append(card);
  }

  startAssistant(author: string, runId: string, text: string): void {
    const message = new AssistantMessage(author, text);
    this.streamingMessages.set(runId, message);
    this.append(message);
  }

  updateAssistant(runId: string, text: string): void {
    this.streamingMessages.get(runId)?.setText(text);
  }

  finishAssistant(author: string, runId: string, text: string): void {
    const existing = this.streamingMessages.get(runId);
    if (existing) {
      existing.setText(text);
      this.streamingMessages.delete(runId);
      return;
    }

    this.addAssistant(author, text);
  }
}
