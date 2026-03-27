import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { createToolContext } from "../tools/file-tools.js";
import { createToolRuntime } from "../tools/runtime.js";
import { ensureBuddyHome, loadConfig, loadSecretToken } from "../config/store.js";
import { runAgentTurn } from "../llm/agent.js";
import { buildSystemPrompt } from "../llm/system-prompt.js";
import { websocketHost, websocketPort } from "../utils/paths.js";
import type {
  ApprovalResponseMessage,
  ChatTurnRequestMessage,
  ClientMessage,
  ServerMessage
} from "./protocol.js";

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withCurrentSystemPrompt(messages: ChatTurnRequestMessage["messages"], systemPrompt: string) {
  const nextMessages = messages.filter((message) => message.role !== "system");
  return [
    {
      role: "system" as const,
      content: systemPrompt
    },
    ...nextMessages
  ];
}

class SocketSession {
  private authenticated = false;
  private readonly toolContext = createToolContext();
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(
    private readonly socket: WebSocket,
    private readonly authToken: string,
    private readonly requestShutdown: () => void
  ) {
    socket.on("message", (chunk: RawData) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      void this.handleMessage(JSON.parse(raw) as ClientMessage);
    });

    socket.on("close", () => {
      for (const approval of this.approvals.values()) {
        approval.resolve(false);
      }
      this.approvals.clear();
    });
  }

  private async handleMessage(message: ClientMessage): Promise<void> {
    if (!this.authenticated) {
      if (message.type !== "auth") {
        this.send({ type: "error", message: "Authentication is required." });
        this.socket.close();
        return;
      }

      if (message.token !== this.authToken) {
        this.send({ type: "error", message: "Invalid auth token." });
        this.socket.close();
        return;
      }

      this.authenticated = true;
      this.send({ type: "auth_ok" });
      return;
    }

    if (message.type === "chat_turn") {
      await this.handleChatTurn(message);
      return;
    }

    if (message.type === "approval_response") {
      this.handleApprovalResponse(message);
      return;
    }

    if (message.type === "status") {
      this.send({
        type: "status_result",
        requestId: message.requestId,
        pid: process.pid
      });
      return;
    }

    if (message.type === "shutdown") {
      this.send({
        type: "shutdown_result",
        requestId: message.requestId
      });
      this.requestShutdown();
    }
  }

  private async handleChatTurn(message: ChatTurnRequestMessage): Promise<void> {
    try {
      const config = await loadConfig();
      const toolRuntime = createToolRuntime(
        config,
        {
          requestApproval: async (request) =>
            await new Promise<boolean>((resolve) => {
              const approvalId = `${message.requestId}:${request.id}`;
              this.approvals.set(approvalId, { resolve });

              this.send({
                type: "approval_request",
                requestId: message.requestId,
                approvalId,
                request
              });
            }),
          onEvent: (event) => {
            this.send({
              type: "tool_event",
              requestId: message.requestId,
              event
            });
          }
        },
        this.toolContext
      );

      const result = await runAgentTurn({
        config,
        messages: withCurrentSystemPrompt(message.messages, buildSystemPrompt(config)),
        userInput: message.userInput,
        toolRuntime
      });

      this.send({
        type: "chat_result",
        requestId: message.requestId,
        messages: result.messages,
        assistantText: result.assistantText
      });
    } catch (error) {
      this.send({
        type: "error",
        requestId: message.requestId,
        message: stringifyError(error)
      });
    }
  }

  private handleApprovalResponse(message: ApprovalResponseMessage): void {
    const approval = this.approvals.get(message.approvalId);
    if (!approval) {
      return;
    }

    this.approvals.delete(message.approvalId);
    approval.resolve(message.approved);
  }

  private send(message: ServerMessage): void {
    if (this.socket.readyState !== this.socket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}

export async function runSocketServer(): Promise<void> {
  await ensureBuddyHome();
  const authToken = await loadSecretToken();

  await new Promise<void>((resolve, reject) => {
    const sockets = new Set<WebSocket>();
    let shuttingDown = false;

    const server = new WebSocketServer({
      host: websocketHost,
      port: websocketPort
    });

    server.on("connection", (socket: WebSocket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });

      new SocketSession(socket, authToken, () => {
        if (shuttingDown) {
          return;
        }

        shuttingDown = true;

        for (const connection of sockets) {
          connection.close();
        }

        server.close(() => resolve());
      });
    });

    server.on("error", (error: Error) => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "EADDRINUSE") {
        reject(new Error("The buddy server is already running."));
        return;
      }

      reject(error);
    });
  });
}
