import type { Component, TUI } from "@mariozechner/pi-tui";
import { Text, type Component as TuiComponent } from "@mariozechner/pi-tui";
import { Frame } from "./frame.js";
import { editorTheme, theme } from "../theme.js";
import { CustomEditor } from "./custom-editor.js";

class EditorContent implements TuiComponent {
  constructor(
    private readonly hint: Text,
    private readonly editor: CustomEditor
  ) {}

  invalidate(): void {
    this.hint.invalidate();
    this.editor.invalidate();
  }

  handleInput(data: string): void {
    this.editor.handleInput(data);
  }

  render(width: number): string[] {
    return [...this.hint.render(width), "", ...this.editor.render(width)];
  }
}

export class TextEditorDialog implements Component {
  private readonly frame: Frame;
  private readonly editor: CustomEditor;

  constructor(params: {
    tui: TUI;
    title: string;
    subtitle?: string;
    initialValue: string;
    onSave: (value: string) => void;
    onCancel: () => void;
  }) {
    const hint = new Text(theme.muted("Enter to save. Esc to cancel."), 0, 0);

    this.editor = new CustomEditor(params.tui, editorTheme, {
      paddingX: 1,
      autocompleteMaxVisible: 6
    });
    this.editor.setText(params.initialValue);
    this.editor.onSubmit = (value) => {
      params.onSave(value.trimEnd());
    };
    this.editor.onEscape = params.onCancel;

    this.frame = new Frame(params.title, new EditorContent(hint, this.editor), params.subtitle);
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
