import type { ClientMessageInput, ProviderInfo, ServerMessage, Thread } from "@pinprompt/protocol";
import { batch, signal } from "@preact/signals";

export type BridgeState = "connecting" | "open" | "closed";

export const bridgeState = signal<BridgeState>("connecting");
export const provider = signal<ProviderInfo | null>(null);
export const project = signal<{ name: string; root: string } | null>(null);
export const threads = signal<ReadonlyMap<string, Thread>>(new Map());
export const lastError = signal<{ message: string; threadId?: string; at: number } | null>(null);

let socket: WebSocket | undefined;
let retry = 500;
let bridgeUrl = "";

export function connect(url: string): void {
  bridgeUrl = url;
  open();
}

export function send(message: ClientMessageInput): boolean {
  if (socket?.readyState !== WebSocket.OPEN) {
    lastError.value = { message: "Not connected to the Pinprompt bridge", at: Date.now() };
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

/** Optimistic insert so a new pin renders before the bridge round-trips. */
export function upsertLocal(thread: Thread): void {
  const next = new Map(threads.value);
  next.set(thread.id, thread);
  threads.value = next;
}

function open(): void {
  const wsUrl = new URL("/ws", bridgeUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  bridgeState.value = "connecting";
  const ws = new WebSocket(wsUrl);
  socket = ws;

  ws.addEventListener("open", () => {
    retry = 500;
    ws.send(JSON.stringify({ type: "hello", protocol: 1, pageUrl: location.href }));
  });
  ws.addEventListener("message", (event) => {
    try {
      handle(JSON.parse(String(event.data)) as ServerMessage);
    } catch (error) {
      console.warn("[pinprompt] bad message", error);
    }
  });
  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    bridgeState.value = "closed";
    setTimeout(open, retry);
    retry = Math.min(retry * 2, 10_000);
  });
}

function handle(message: ServerMessage): void {
  switch (message.type) {
    case "ready":
      batch(() => {
        bridgeState.value = "open";
        provider.value = message.provider;
        project.value = message.project;
        threads.value = new Map(message.threads.map((thread) => [thread.id, thread]));
      });
      return;
    case "provider.status":
      provider.value = message.provider;
      return;
    case "thread.upsert":
      upsertLocal(message.thread);
      return;
    case "thread.removed": {
      const next = new Map(threads.value);
      next.delete(message.threadId);
      threads.value = next;
      return;
    }
    case "error":
      lastError.value = { message: message.message, threadId: message.threadId, at: Date.now() };
      return;
  }
}
