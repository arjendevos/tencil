import { bridgeState, provider } from "../connection.ts";
import {
  activeCount,
  hidden,
  inboxOpen,
  mode,
  startPicking,
  stopPicking,
  unresolvedCount,
} from "../state.ts";
import { CommentIcon, EyeIcon, EyeOffIcon, InboxIcon } from "./icons.tsx";

export function Toolbar() {
  const status = connectionStatus();
  const picking = mode.value === "picking";
  return (
    <div class="toolbar-wrap">
      {picking && <div class="toolbar-hint">Click any element to pin a prompt · Esc to cancel</div>}
      {!picking && status.hint && (
        <div class={`toolbar-hint hint-${status.tone}`}>{status.hint}</div>
      )}
      <div class="toolbar">
        <span class={`status-dot status-${status.tone}`} title={status.title}>
          {activeCount.value > 0 && <span class="status-ping" />}
        </span>
        <span class="divider" />
        <button
          type="button"
          class={`tool${picking ? " tool-active" : ""}`}
          title="Comment (C)"
          onClick={() => (picking ? stopPicking() : startPicking())}
        >
          <CommentIcon />
          <span class="tool-label">Comment</span>
          <kbd>C</kbd>
        </button>
        <button
          type="button"
          class={`tool${inboxOpen.value ? " tool-active" : ""}`}
          title="Pins"
          onClick={() => {
            inboxOpen.value = !inboxOpen.value;
          }}
        >
          <InboxIcon />
          {unresolvedCount.value > 0 && <span class="badge">{unresolvedCount.value}</span>}
        </button>
        <button
          type="button"
          class="tool"
          title={hidden.value ? "Show pins" : "Hide pins"}
          onClick={() => {
            hidden.value = !hidden.value;
            if (hidden.value) stopPicking();
          }}
        >
          {hidden.value ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function connectionStatus(): { tone: "ok" | "warn" | "error"; title: string; hint?: string } {
  if (bridgeState.value !== "open") {
    return {
      tone: "error",
      title: "Pinprompt bridge offline",
      hint:
        bridgeState.value === "connecting"
          ? undefined
          : "Pinprompt bridge is offline. Run npx pinprompt in your project.",
    };
  }
  const info = provider.value;
  if (!info) return { tone: "warn", title: "Connecting…" };
  switch (info.state) {
    case "ready":
      return { tone: "ok", title: `${info.label}${info.target ? ` · ${info.target}` : ""}` };
    case "unauthorized":
      return {
        tone: "warn",
        title: `${info.label}: not paired`,
        hint: `Pair with ${info.label}: run npx pinprompt connect`,
      };
    case "unavailable":
      return {
        tone: "error",
        title: info.detail ?? `${info.label} unavailable`,
        hint: info.detail,
      };
    default:
      return { tone: "warn", title: `Connecting to ${info.label}…` };
  }
}
