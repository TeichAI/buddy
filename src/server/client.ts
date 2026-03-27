import crypto from "node:crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import WebSocket, { type RawData } from "ws";
import { loadSecretToken } from "../config/store.js";
import type {
  ApprovalRequestMessage,
  ClientMessage,
  ServerMessage,
  StatusResultMessage
} from "./protocol.js";
import { websocketUrl } from "../utils/paths.js";
import type { ToolApprovalRequest, ToolRuntimeEvent } from "../tools/runtime.js";

interface PendingTurn {
  onToolEvent?: (event: ToolRuntimeEvent) => void;
  requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
  resolve: (value: { messages: ChatCompletionMessageParam[]; assistantText: string }) => void;
  reject: (error: Error) => void;
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

function parseMessage(raw: string): ServerMessage {
  return JSON.parse(raw) as ServerMessage;
}

export class BuddySocketClient {
  private socket: WebSocket | null = null;
  private authenticated = false;
  private readonly pendingTurns = new Map<string, PendingTurn>();
  private readonly pendingStatus = new Map<string, PendingRequest<StatusResultMessage>>();
  private readonly pendingShutdown = new Map<string, PendingRequest<void>>();

  async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.authenticated) {
      return;
    }

    const token = await loadSecretToken();

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(websocketUrl);
      let settled = false;

      const cleanup = () => {
        socket.off("open", onOpen);
        socket.off("error", onInitialError);
      };

      const failPending = (error: Error) => {
        for (const pending of this.pendingTurns.values()) {
          pending.reject(error);
        }
        for (const pending of this.pendingStatus.values()) {
          pending.reject(error);
        }
        for (const pending of this.pendingShutdown.values()) {
          pending.reject(error);
        }
        this.pendingTurns.clear();
        this.pendingStatus.clear();
        this.pendingShutdown.clear();
      };

      const onOpen = () => {
        this.socket = socket;
        this.authenticated = false;

        socket.on("message", (chunk: RawData) => {
          const raw = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          this.handleMessage(parseMessage(raw));
        });
        socket.on("close", () => {
          this.socket = null;
          this.authenticated = false;
          failPending(new Error("The buddy server connection closed."));
        });
        socket.on("error", (error: Error) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }

          failPending(error instanceof Error ? error : new Error(String(error)));
        });

        this.sendRaw({ type: "auth", token });
      };

      const onInitialError = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      socket.once("open", onOpen);
      socket.once("error", onInitialError);

      const waitForAuth = () => {
        if (this.authenticated) {
          if (!settled) {
            settled = true;
            cleanup();
            resolve();
          }
          return;
        }

        if (socket.readyState === WebSocket.CLOSED) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error("The buddy server connection closed during authentication."));
          }
          return;
        }

        setTimeout(waitForAuth, 10);
      };

      waitForAuth();
    });
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return;
    }

    await new Promise<void>((resolve) => {
      const socket = this.socket;
      if (!socket) {
        resolve();
        return;
      }

      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      socket.once("close", () => resolve());
      socket.close();
    });
  }

  async sendChatTurn(params: {
    messages: ChatCompletionMessageParam[];
    userInput: string;
    onToolEvent?: (event: ToolRuntimeEvent) => void;
    requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
  }): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string }> {
    await this.connect();

    const requestId = createRequestId();
    return await new Promise((resolve, reject) => {
      this.pendingTurns.set(requestId, {
        onToolEvent: params.onToolEvent,
        requestApproval: params.requestApproval,
        resolve,
        reject
      });

      this.sendRaw({
        type: "chat_turn",
        requestId,
        messages: params.messages,
        userInput: params.userInput
      });
    });
  }

  async getStatus(): Promise<{ pid: number }> {
    await this.connect();

    const requestId = createRequestId();
    return await new Promise((resolve, reject) => {
      this.pendingStatus.set(requestId, {
        resolve: (message) => resolve({ pid: message.pid }),
        reject
      });

      this.sendRaw({
        type: "status",
        requestId
      });
    });
  }

  async shutdownServer(): Promise<void> {
    await this.connect();

    const requestId = createRequestId();
    return await new Promise((resolve, reject) => {
      this.pendingShutdown.set(requestId, { resolve, reject });
      this.sendRaw({
        type: "shutdown",
        requestId
      });
    });
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "auth_ok") {
      this.authenticated = true;
      return;
    }

    if (message.type === "error") {
      const error = new Error(message.message);

      if (message.requestId) {
        const pendingTurn = this.pendingTurns.get(message.requestId);
        if (pendingTurn) {
          this.pendingTurns.delete(message.requestId);
          pendingTurn.reject(error);
          return;
        }

        const pendingStatus = this.pendingStatus.get(message.requestId);
        if (pendingStatus) {
          this.pendingStatus.delete(message.requestId);
          pendingStatus.reject(error);
          return;
        }

        const pendingShutdown = this.pendingShutdown.get(message.requestId);
        if (pendingShutdown) {
          this.pendingShutdown.delete(message.requestId);
          pendingShutdown.reject(error);
          return;
        }
      }

      throw error;
    }

    if (message.type === "tool_event") {
      const pending = this.pendingTurns.get(message.requestId);
      pending?.onToolEvent?.(message.event);
      return;
    }

    if (message.type === "approval_request") {
      void this.handleApprovalRequest(message);
      return;
    }

    if (message.type === "chat_result") {
      const pending = this.pendingTurns.get(message.requestId);
      if (!pending) {
        return;
      }

      this.pendingTurns.delete(message.requestId);
      pending.resolve({
        messages: message.messages,
        assistantText: message.assistantText
      });
      return;
    }

    if (message.type === "status_result") {
      const pending = this.pendingStatus.get(message.requestId);
      if (!pending) {
        return;
      }

      this.pendingStatus.delete(message.requestId);
      pending.resolve(message);
      return;
    }

    if (message.type === "shutdown_result") {
      const pending = this.pendingShutdown.get(message.requestId);
      if (!pending) {
        return;
      }

      this.pendingShutdown.delete(message.requestId);
      pending.resolve();
    }
  }

  private async handleApprovalRequest(message: ApprovalRequestMessage): Promise<void> {
    const pending = this.pendingTurns.get(message.requestId);
    if (!pending) {
      return;
    }

    let approved = false;
    try {
      approved = pending.requestApproval
        ? await pending.requestApproval(message.request)
        : false;
    } catch {
      approved = false;
    }

    this.sendRaw({
      type: "approval_response",
      requestId: message.requestId,
      approvalId: message.approvalId,
      approved
    });
  }

  private sendRaw(message: ClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("The buddy server is not connected.");
    }

    socket.send(JSON.stringify(message));
  }
}
