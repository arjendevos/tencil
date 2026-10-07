import type { Thread } from "@pinprompt/protocol";
import { useState } from "preact/hooks";
import {
  currentPage,
  inboxOpen,
  openThreadId,
  pageKey,
  showResolved,
  sortedThreads,
} from "../state.ts";
import { CloseIcon } from "./icons.tsx";
import { pinNumbers, pinVariant } from "./Pins.tsx";

/** Survives the full reload when jumping to a pin on another page. */
export const PENDING_OPEN_KEY = "pinprompt:open";

export function Inbox() {
  const [scope, setScope] = useState<"page" | "all">("page");
  if (!inboxOpen.value) return null;

  const list = sortedThreads.value
    .filter((thread) => showResolved.value || !thread.resolved)
    .filter((thread) => scope === "all" || pageKey(thread.pageUrl) === currentPage.value);

  return (
    <aside class="inbox">
      <header class="inbox-header">
        <strong>Pins</strong>
        <div class="segmented">
          <button
            type="button"
            class={scope === "page" ? "active" : ""}
            onClick={() => setScope("page")}
          >
            This page
          </button>
          <button
            type="button"
            class={scope === "all" ? "active" : ""}
            onClick={() => setScope("all")}
          >
            All
          </button>
        </div>
        <button
          type="button"
          class="icon-button"
          title="Close"
          onClick={() => {
            inboxOpen.value = false;
          }}
        >
          <CloseIcon />
        </button>
      </header>
      <label class="inbox-filter">
        <input
          type="checkbox"
          checked={showResolved.value}
          onChange={(event) => {
            showResolved.value = (event.target as HTMLInputElement).checked;
          }}
        />
        Show resolved
      </label>
      <div class="inbox-list">
        {list.length === 0 ? (
          <p class="empty">
            No pins yet. Press <kbd>C</kbd> and click anything on the page.
          </p>
        ) : (
          list.map((thread) => <InboxItem key={thread.id} thread={thread} />)
        )}
      </div>
    </aside>
  );
}

function InboxItem({ thread }: { thread: Thread }) {
  const samePage = pageKey(thread.pageUrl) === currentPage.value;
  const last = [...thread.messages].reverse().find((message) => message.role === "assistant");
  const open = () => {
    if (!samePage) {
      sessionStorage.setItem(PENDING_OPEN_KEY, thread.id);
      location.href = thread.pageUrl;
      return;
    }
    openThreadId.value = thread.id;
    revealAnchor(thread);
  };
  return (
    <button
      type="button"
      class={`inbox-item${openThreadId.value === thread.id ? " active" : ""}`}
      onClick={open}
    >
      <span class={`pin pin-static pin-${pinVariant(thread)}`}>
        <span class="pin-body">{pinNumbers.value.get(thread.id)}</span>
      </span>
      <span class="inbox-item-body">
        <span class="inbox-item-title">{thread.title}</span>
        <span class="inbox-item-meta">
          {!samePage && <span>{new URL(thread.pageUrl).pathname} · </span>}
          {statusLabel(thread)} · {timeAgo(thread.updatedAt)}
        </span>
        {last && <span class="inbox-item-preview">{last.text.slice(0, 140)}</span>}
      </span>
    </button>
  );
}

export function revealAnchor(thread: Thread): void {
  try {
    document
      .querySelector(thread.anchor.selector)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch {
    // Invalid selector from an older page version; the panel still opens.
  }
}

function statusLabel(thread: Thread): string {
  if (thread.resolved) return "Resolved";
  switch (thread.status) {
    case "starting":
      return "Starting";
    case "working":
      return "Working";
    case "waiting":
      return "Needs input";
    case "error":
      return "Error";
    default:
      return "Done";
  }
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
