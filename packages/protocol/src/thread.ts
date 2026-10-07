import { z } from "zod";
import { Anchor, ElementContext } from "./context.ts";

/**
 * Provider-agnostic run state.
 * - `starting`: thread is being created on the provider
 * - `working`: the agent is producing a turn
 * - `waiting`: the agent needs approval/input inside the provider UI
 * - `idle`: last turn finished, ready for a follow-up
 * - `error`: last turn or the thread itself failed
 */
export const ThreadStatus = z.enum(["starting", "working", "waiting", "idle", "error"]);
export type ThreadStatus = z.infer<typeof ThreadStatus>;

export const MessageRole = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRole>;

export const ThreadMessage = z.object({
  id: z.string(),
  role: MessageRole,
  /** Cumulative text; replaces the previous value on every update. */
  text: z.string(),
  streaming: z.boolean().default(false),
  createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessage>;

/** A pin on a page, backed by one provider thread. Owned and persisted by the bridge. */
export const Thread = z.object({
  id: z.string(),
  title: z.string(),
  pageUrl: z.string(),
  anchor: Anchor,
  context: ElementContext,
  status: ThreadStatus,
  statusDetail: z.string().optional(),
  resolved: z.boolean().default(false),
  messages: z.array(ThreadMessage),
  provider: z.object({
    id: z.string(),
    threadId: z.string().optional(),
    /** Deep link into the provider UI, when it has one. */
    url: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Thread = z.infer<typeof Thread>;
