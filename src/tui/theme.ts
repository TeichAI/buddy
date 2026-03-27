import type { EditorTheme, MarkdownTheme, SelectListTheme, SettingsListTheme } from "@mariozechner/pi-tui";
import chalk from "chalk";

const palette = {
  text: "#ECE7DA",
  muted: "#8E938F",
  accent: "#F4A261",
  accentStrong: "#E76F51",
  success: "#6FB98F",
  border: "#4B4F57",
  panel: "#1C1F24",
  userPanel: "#2A2E35",
  toolPanel: "#262B33",
  toolPanelSuccess: "#203229",
  toolPanelError: "#352225",
  code: "#E9C46A",
  link: "#7CC6A0",
  quote: "#8AB6D6",
  error: "#F28482"
} as const;

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);
const bg = (hex: string) => (text: string) => chalk.bgHex(hex)(text);

export const theme = {
  text: fg(palette.text),
  muted: fg(palette.muted),
  accent: fg(palette.accent),
  accentStrong: fg(palette.accentStrong),
  success: fg(palette.success),
  error: fg(palette.error),
  border: fg(palette.border),
  userPanel: bg(palette.userPanel),
  panel: bg(palette.panel),
  toolPanel: bg(palette.toolPanel),
  toolPanelSuccess: bg(palette.toolPanelSuccess),
  toolPanelError: bg(palette.toolPanelError),
  title: (text: string) => chalk.bold(fg(palette.accent)(text)),
  heading: (text: string) => chalk.bold(fg(palette.accentStrong)(text)),
  dim: (text: string) => chalk.dim(text)
};

export const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.bold(fg(palette.accent)(text)),
  link: fg(palette.link),
  linkUrl: theme.muted,
  code: fg(palette.code),
  codeBlock: fg(palette.code),
  codeBlockBorder: theme.border,
  quote: fg(palette.quote),
  quoteBorder: fg(palette.quote),
  hr: theme.border,
  listBullet: fg(palette.accentStrong),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text)
};

export const editorTheme: EditorTheme = {
  borderColor: theme.border,
  selectList: {
    selectedPrefix: theme.accent,
    selectedText: (text) => chalk.bold(theme.accent(text)),
    description: theme.muted,
    scrollInfo: theme.muted,
    noMatch: theme.muted
  }
};

export const selectTheme: SelectListTheme = editorTheme.selectList;

export const settingsTheme: SettingsListTheme = {
  label: (text, selected) => (selected ? chalk.bold(theme.accent(text)) : theme.text(text)),
  value: (text, selected) => (selected ? theme.accentStrong(text) : theme.muted(text)),
  description: theme.muted,
  cursor: theme.accent("→ "),
  hint: theme.muted
};
