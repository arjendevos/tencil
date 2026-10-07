import {
  ClientMessage,
  PROTOCOL_VERSION,
  type Provider,
  type ProviderMessage,
  type ServerMessage,
  type Thread,
  type ThreadMessage,
} from "@pinprompt/protocol";
import { renderPrompt, stripContext, titleFor } from "./prompt.ts";
import type { ThreadStore } from "./store.ts";

export interface BridgeClient {
  send(message: ServerMessage): void;
}

export interface BridgeOptions {
  provider: Provider;
  store: ThreadStore;
  project: { name: string; root: string };
  version: string;
  log?: (message: string) => void;
}

/** Local echo ids, replaced once the provider reports the real user message. */
const LOCAL_PREFIX = "local:";
const BROADCAST_THROTTLE_MS = 80;

/**
 * Owns pins and fans provider updates out to every connected overlay. One
 * bridge serves one project; any number of tabs may be connected.
 */
export class Bridge {
  readonly #options: BridgeOptions;
  readonly #clients = new Set<BridgeClient>();
  readonly #unwatch = new Map<string, () => void>();
  readonly #pendingBroadcast = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #offInfo: () => void;

  constructor(options: BridgeOptions) {
    this.#options = options;
    this.#offInfo = options.provider.onInfoChange((provider) =>
      this.#broadcast({ type: "provider.status", provider }),
    );
    for (const thread of options.store.list()) {
      if (thread.provider.id === options.provider.id && thread.provider.threadId) {
        this.#watch(thread.id, thread.provider.threadId);
      }
    }
  }

  connect(client: BridgeClient): () => void {
    this.#clients.add(client);
    return () => this.#clients.delete(client);
  }

  async handle(client: BridgeClient, raw: unknown): Promise<void> {
    const parsed = ClientMessage.safeParse(raw);
    if (!parsed.success) {
      client.send({
        type: "error",
        message: `Invalid message: ${parsed.error.issues[0]?.message}`,
      });
      return;
    }
    const message = parsed.data;
    try {
      switch (message.type) {
        case "hello":
          client.send({
            type: "ready",
            protocol: PROTOCOL_VERSION,
            version: this.#options.version,
            project: this.#options.project,
            provider: this.#options.provider.info(),
            threads: this.#options.store.list(),
          });
          return;
        case "thread.create":
          await this.#create(message);
          return;
        case "thread.reply":
          await this.#reply(message);
          return;
        case "thread.interrupt": {
          const thread = this.#require(message.threadId);
          if (thread.provider.threadId) {
            await this.#options.provider.interrupt(thread.provider.threadId);
          }
          return;
        }
        case "thread.resolve":
          this.#update(message.threadId, (thread) => ({ ...thread, resolved: message.resolved }));
          return;
        case "thread.delete":
          this.#unwatch.get(message.threadId)?.();
          this.#unwatch.delete(message.threadId);
          if (this.#options.store.delete(message.threadId)) {
            this.#broadcast({ type: "thread.removed", threadId: message.threadId });
          }
          return;
      }
    } catch (error) {
      const threadId = "threadId" in message ? message.threadId : undefined;
      client.send({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        ...(threadId ? { threadId } : {}),
      });
    }
  }

  async dispose(): Promise<void> {
    this.#offInfo();
    for (const unwatch of this.#unwatch.values()) unwatch();
    for (const timer of this.#pendingBroadcast.values()) clearTimeout(timer);
    await this.#options.store.flush();
  }

  /* --------------------------------- actions --------------------------------- */

  async #create(message: Extract<ClientMessage, { type: "thread.create" }>): Promise<void> {
    const { provider, store } = this.#options;
    if (store.get(message.id)) throw new Error(`Thread ${message.id} already exists`);
    const now = new Date().toISOString();
    const thread: Thread = {
      id: message.id,
      title: titleFor(message.prompt, message.context),
      pageUrl: message.pageUrl,
      anchor: message.anchor,
      context: message.context,
      status: "starting",
      resolved: false,
      messages: [localMessage(message.prompt, now)],
      provider: { id: provider.id },
      createdAt: now,
      updatedAt: now,
    };
    store.upsert(thread);
    this.#broadcastThread(thread, true);

    try {
      const created = await provider.createThread({
        title: thread.title,
        text: renderPrompt({
          prompt: message.prompt,
          pageUrl: message.pageUrl,
          context: message.context,
          hasScreenshot: message.attachments.length > 0,
        }),
        attachments: message.attachments,
      });
      this.#update(thread.id, (current) => ({
        ...current,
        status: "working",
        provider: { id: provider.id, threadId: created.providerThreadId, url: created.url },
      }));
      this.#watch(thread.id, created.providerThreadId);
      this.#options.log?.(`Pin "${thread.title}" → ${provider.label}`);
    } catch (error) {
      this.#update(thread.id, (current) => ({
        ...current,
        status: "error",
        statusDetail: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async #reply(message: Extract<ClientMessage, { type: "thread.reply" }>): Promise<void> {
    const thread = this.#require(message.threadId);
    if (!thread.provider.threadId) throw new Error("This pin has no agent thread yet");
    this.#update(thread.id, (current) => ({
      ...current,
      resolved: false,
      status: "working",
      statusDetail: undefined,
      messages: [...current.messages, localMessage(message.text, new Date().toISOString())],
    }));
    await this.#options.provider.sendMessage({
      providerThreadId: thread.provider.threadId,
      text: message.text,
      attachments: message.attachments,
    });
  }

  /* ------------------------------ provider sink ------------------------------ */

  #watch(threadId: string, providerThreadId: string): void {
    this.#unwatch.get(threadId)?.();
    const unwatch = this.#options.provider.watch(providerThreadId, {
      message: (message) => this.#update(threadId, (thread) => mergeMessage(thread, message)),
      status: (status, statusDetail) =>
        this.#update(threadId, (thread) => ({ ...thread, status, statusDetail })),
      gone: () =>
        this.#update(threadId, (thread) => ({
          ...thread,
          status: "error",
          statusDetail: `Thread no longer exists in ${this.#options.provider.label}`,
        })),
    });
    this.#unwatch.set(threadId, unwatch);
  }

  /* --------------------------------- helpers --------------------------------- */

  #require(threadId: string): Thread {
    const thread = this.#options.store.get(threadId);
    if (!thread) throw new Error(`Unknown thread ${threadId}`);
    return thread;
  }

  #update(threadId: string, change: (thread: Thread) => Thread): void {
    const current = this.#options.store.get(threadId);
    if (!current) return;
    const next = { ...change(current), updatedAt: new Date().toISOString() };
    this.#options.store.upsert(next);
    this.#broadcastThread(next);
  }

  /** Streaming produces many updates per second; coalesce per thread. */
  #broadcastThread(thread: Thread, immediate = false): void {
    const send = () => {
      this.#pendingBroadcast.delete(thread.id);
      const latest = this.#options.store.get(thread.id);
      if (latest) this.#broadcast({ type: "thread.upsert", thread: latest });
    };
    if (immediate) {
      clearTimeout(this.#pendingBroadcast.get(thread.id));
      send();
      return;
    }
    if (this.#pendingBroadcast.has(thread.id)) return;
    this.#pendingBroadcast.set(thread.id, setTimeout(send, BROADCAST_THROTTLE_MS));
  }

  #broadcast(message: ServerMessage): void {
    for (const client of this.#clients) client.send(message);
  }
}

function localMessage(text: string, createdAt: string): ThreadMessage {
  return {
    id: `${LOCAL_PREFIX}${crypto.randomUUID()}`,
    role: "user",
    text,
    streaming: false,
    createdAt,
  };
}

export function mergeMessage(thread: Thread, incoming: ProviderMessage): Thread {
  const message: ThreadMessage = {
    ...incoming,
    text: incoming.role === "user" ? stripContext(incoming.text) : incoming.text,
  };
  let messages = thread.messages;
  if (message.role === "user") {
    // Swap the optimistic echo for the provider's copy.
    const echo = messages.findIndex(
      (m) => m.id.startsWith(LOCAL_PREFIX) && m.text.trim() === message.text.trim(),
    );
    if (echo !== -1) messages = messages.filter((_, index) => index !== echo);
  }
  const index = messages.findIndex((m) => m.id === message.id);
  if (index === -1) {
    messages = [...messages, message].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        // Keep unconfirmed local echoes after confirmed messages with the same timestamp.
        Number(a.id.startsWith(LOCAL_PREFIX)) - Number(b.id.startsWith(LOCAL_PREFIX)),
    );
  } else {
    messages = messages.map((m, i) => (i === index ? message : m));
  }
  return { ...thread, messages };
}
