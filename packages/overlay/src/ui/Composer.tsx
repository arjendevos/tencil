import type { ImageAttachment, Thread } from "@pinprompt/protocol";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { provider, send, upsertLocal } from "../connection.ts";
import { getHost } from "../host.ts";
import { captureElement } from "../screenshot.ts";
import { draft, layoutTick, openThreadId } from "../state.ts";
import { CameraIcon, CodeIcon } from "./icons.tsx";
import { PromptInput } from "./PromptInput.tsx";
import { popoverPosition, resolveAnchor } from "./position.ts";

const WIDTH = 340;

export function Composer() {
  layoutTick.value;
  const pending = draft.value;
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(140);
  const [withScreenshot, setWithScreenshot] = useState(true);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  });

  if (!pending) return null;
  const point = resolveAnchor(pending.anchor, pending.element);
  if (!point) return null;
  const { left, top, origin } = popoverPosition(point, { width: WIDTH, height });
  const target = provider.value;
  const ready = target?.state === "ready";

  const submit = async (prompt: string) => {
    setBusy(true);
    try {
      const context = await pending.context;
      const attachments: ImageAttachment[] = [];
      if (withScreenshot) {
        const shot = await captureElement(pending.element, getHost());
        if (shot) attachments.push(shot);
      }
      const id = crypto.randomUUID();
      const anchor = { ...pending.anchor, selector: context.selector };
      const ok = send({
        type: "thread.create",
        id,
        pageUrl: location.href,
        prompt,
        anchor,
        context,
        attachments,
      });
      if (!ok) return;
      const now = new Date().toISOString();
      const optimistic: Thread = {
        id,
        title: prompt,
        pageUrl: location.href,
        anchor,
        context,
        status: "starting",
        resolved: false,
        messages: [
          { id: `local:${id}`, role: "user", text: prompt, streaming: false, createdAt: now },
        ],
        provider: { id: target?.id ?? "unknown" },
        createdAt: now,
        updatedAt: now,
      };
      upsertLocal(optimistic);
      draft.value = null;
      openThreadId.value = id;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={ref}
      class="popover composer"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${WIDTH}px`,
        transformOrigin: origin,
      }}
    >
      <div class="composer-target">
        <span class="chip">
          <CodeIcon />
          {pending.label}
        </span>
        {target && (
          <span class="composer-provider">
            → {target.label}
            {target.target ? ` · ${target.target}` : ""}
          </span>
        )}
      </div>
      <PromptInput
        placeholder={ready ? "What should change here?" : "Waiting for the agent connection…"}
        autoFocus
        busy={busy}
        disabled={!ready}
        onSubmit={submit}
        onCancel={() => {
          draft.value = null;
        }}
      >
        <button
          type="button"
          class={`toggle${withScreenshot ? " toggle-on" : ""}`}
          onClick={() => setWithScreenshot(!withScreenshot)}
          title={withScreenshot ? "Screenshot attached" : "No screenshot"}
          aria-pressed={withScreenshot}
        >
          <CameraIcon />
        </button>
      </PromptInput>
      {!ready && target?.detail && <p class="hint">{target.detail}</p>}
    </div>
  );
}
