import type { Thread } from "@pinprompt/protocol";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { provider, send, threads } from "../connection.ts";
import { layoutTick, openThreadId } from "../state.ts";
import {
  CheckIcon,
  CloseIcon,
  CodeIcon,
  ExternalIcon,
  StopIcon,
  TrashIcon,
  UndoIcon,
} from "./icons.tsx";
import { Markdown } from "./markdown.tsx";
import { pinNumbers } from "./Pins.tsx";
import { PromptInput } from "./PromptInput.tsx";
import { popoverPosition, resolveAnchor } from "./position.ts";

const WIDTH = 380;

export function ThreadPanel() {
  layoutTick.value;
  const id = openThreadId.value;
  const thread = id ? threads.value.get(id) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(320);

  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  });

  if (!thread) return null;
  const point = resolveAnchor(thread.anchor) ?? {
    x: window.innerWidth / 2 - WIDTH / 2,
    y: window.innerHeight / 3,
  };
  const { left, top } = popoverPosition(point, { width: WIDTH, height });

  return (
    <div
      ref={ref}
      class="popover thread"
      style={{ left: `${left}px`, top: `${top}px`, width: `${WIDTH}px` }}
    >
      <Header thread={thread} />
      <Messages thread={thread} />
      <StatusLine thread={thread} />
      <PromptInput
        placeholder={thread.provider.threadId ? "Reply…" : "Waiting for the agent…"}
        disabled={!thread.provider.threadId}
        onSubmit={(text) => {
          send({ type: "thread.reply", threadId: thread.id, text });
        }}
        onCancel={() => {
          openThreadId.value = null;
        }}
      />
    </div>
  );
}

function Header({ thread }: { thread: Thread }) {
  const component = thread.context.components[0];
  const source = component?.source;
  return (
    <div class="thread-header">
      <div class="thread-heading">
        <span class="thread-number">#{pinNumbers.value.get(thread.id)}</span>
        <span class="chip" title={thread.context.selector}>
          <CodeIcon />
          {component?.name ?? `<${thread.context.tagName}>`}
        </span>
        {source && (
          <span class="thread-source" title={source.file}>
            {source.file.split("/").pop()}
            {source.line ? `:${source.line}` : ""}
          </span>
        )}
      </div>
      <div class="thread-tools">
        {thread.provider.url && (
          <a
            class="icon-button"
            href={thread.provider.url}
            target="_blank"
            rel="noreferrer"
            title={`Open in ${provider.value?.label ?? "agent"}`}
          >
            <ExternalIcon />
          </a>
        )}
        <button
          type="button"
          class="icon-button"
          title={thread.resolved ? "Reopen" : "Resolve"}
          onClick={() =>
            send({ type: "thread.resolve", threadId: thread.id, resolved: !thread.resolved })
          }
        >
          {thread.resolved ? <UndoIcon /> : <CheckIcon />}
        </button>
        <button
          type="button"
          class="icon-button"
          title="Delete pin (keeps the agent thread)"
          onClick={() => {
            send({ type: "thread.delete", threadId: thread.id });
            openThreadId.value = null;
          }}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          class="icon-button"
          title="Close (Esc)"
          onClick={() => {
            openThreadId.value = null;
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function Messages({ thread }: { thread: Thread }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = thread.messages[thread.messages.length - 1];

  // Follow streaming output unless the user scrolled up to read.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (nearBottom) element.scrollTop = element.scrollHeight;
  }, [last?.id, last?.text.length]);

  return (
    <div ref={ref} class="messages">
      {thread.messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} class="message message-user">
            {message.text}
          </div>
        ) : (
          <div key={message.id} class="message message-assistant">
            <Markdown text={message.text} />
            {message.streaming && <span class="caret" />}
          </div>
        ),
      )}
    </div>
  );
}

function StatusLine({ thread }: { thread: Thread }) {
  if (thread.status === "starting") {
    return (
      <div class="status-line">
        <span class="dots" />
        Starting a thread in {provider.value?.label ?? "the agent"}…
      </div>
    );
  }
  if (thread.status === "working") {
    return (
      <div class="status-line">
        <span class="dots" />
        Working…
        <button
          type="button"
          class="stop"
          onClick={() => send({ type: "thread.interrupt", threadId: thread.id })}
        >
          <StopIcon /> Stop
        </button>
      </div>
    );
  }
  if (thread.status === "waiting") {
    return (
      <div class="status-line status-waiting">
        {thread.statusDetail ?? "Waiting for input"}
        {thread.provider.url && (
          <a href={thread.provider.url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
      </div>
    );
  }
  if (thread.status === "error") {
    return (
      <div class="status-line status-error">{thread.statusDetail ?? "Something went wrong"}</div>
    );
  }
  return null;
}
