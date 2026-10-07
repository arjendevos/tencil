/** Lives inside the shadow root, so nothing here leaks into (or from) the page. */
export const styles = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }

.root {
  --accent: #ff4f2e;
  --accent-soft: rgba(255, 79, 46, 0.14);
  --bg: #111113;
  --bg-elevated: #1a1a1d;
  --bg-hover: #232327;
  --border: rgba(255, 255, 255, 0.09);
  --text: #ededef;
  --text-muted: #9b9ba3;
  --ok: #3dd68c;
  --warn: #f5b84a;
  --error: #ff6369;
  --radius: 12px;
  --shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 40px -8px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.4);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
.root.picking { cursor: crosshair; }

button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
a { color: inherit; }
kbd {
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 5px; border-radius: 4px;
  background: rgba(255,255,255,0.08); color: var(--text-muted);
}

/* ------------------------------- highlight ------------------------------- */
.highlight {
  position: fixed; left: 0; top: 0;
  border: 1.5px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 3px;
  pointer-events: none;
  transition: transform 60ms ease-out, width 60ms ease-out, height 60ms ease-out;
}
.highlight-label {
  position: fixed; left: 0; top: 0;
  display: flex; gap: 6px; align-items: center;
  padding: 3px 7px; border-radius: 6px;
  background: var(--accent); color: white;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  pointer-events: none;
}
.highlight-size { opacity: 0.75; font-weight: 500; }

/* ---------------------------------- pins --------------------------------- */
.pin {
  position: fixed; left: 0; top: 0; width: 0; height: 0;
  pointer-events: auto;
  --pin: var(--accent);
}
.pin-body {
  position: absolute; left: 0; bottom: 0;
  min-width: 28px; height: 28px; padding: 0 8px;
  display: grid; place-items: center;
  border-radius: 14px 14px 14px 3px;
  background: var(--pin); color: white;
  font-size: 12px; font-weight: 700;
  border: 2px solid white;
  box-shadow: 0 4px 14px -2px rgba(0,0,0,0.45);
  transition: transform 120ms ease;
  transform-origin: bottom left;
}
.pin:hover .pin-body, .pin-open .pin-body { transform: scale(1.12); }
.pin-done { --pin: #2f6fed; }
.pin-waiting { --pin: #e69a10; }
.pin-error { --pin: #e5484d; }
.pin-resolved { --pin: #6b6b74; }
.pin-resolved .pin-body { opacity: 0.75; }
.pin-draft .pin-body { background: var(--bg); border-color: var(--accent); color: var(--accent); }
.pin-working .pin-body::after {
  content: ""; position: absolute; inset: -6px;
  border-radius: 18px 18px 18px 6px;
  border: 2px solid transparent; border-top-color: var(--pin); border-right-color: var(--pin);
  animation: spin 900ms linear infinite;
}
.pin-static { position: relative; width: 28px; height: 28px; flex: none; pointer-events: none; }
.pin-static .pin-body { transform: none; }
@keyframes spin { to { transform: rotate(360deg); } }

/* -------------------------------- popovers -------------------------------- */
.popover {
  position: fixed;
  pointer-events: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  animation: pop 140ms cubic-bezier(.2,.9,.3,1.2);
}
@keyframes pop { from { opacity: 0; transform: translateY(4px) scale(0.98); } }

.composer { padding: 10px; display: grid; gap: 8px; }
.composer-target { display: flex; align-items: center; gap: 8px; min-width: 0; }
.composer-provider { color: var(--text-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hint { margin: 0; color: var(--warn); font-size: 12px; }

.chip {
  display: inline-flex; align-items: center; gap: 5px;
  max-width: 200px; padding: 2px 8px; border-radius: 999px;
  background: var(--accent-soft); color: #ff9a85;
  font: 12px/18px ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.prompt-input {
  display: grid; gap: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 8px 6px 10px;
}
.prompt-input:focus-within { border-color: rgba(255, 79, 46, 0.55); }
.prompt-input textarea {
  all: unset; display: block; width: 100%;
  min-height: 20px; max-height: 200px; overflow-y: auto;
  color: var(--text); font: inherit; white-space: pre-wrap; word-break: break-word;
}
.prompt-input textarea::placeholder { color: var(--text-muted); }
.prompt-input textarea:disabled { opacity: 0.6; }
.prompt-actions { display: flex; align-items: center; justify-content: space-between; }
.prompt-extras { display: flex; gap: 4px; }
.send {
  width: 26px; height: 26px; border-radius: 999px;
  display: grid; place-items: center;
  background: var(--accent); color: white;
  transition: opacity 120ms, transform 120ms;
}
.send:disabled { opacity: 0.3; cursor: default; }
.send:not(:disabled):hover { transform: scale(1.06); }
.toggle {
  height: 24px; padding: 0 7px; border-radius: 6px;
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--text-muted);
}
.toggle:hover { background: var(--bg-hover); }
.toggle-on { color: var(--text); background: rgba(255,255,255,0.06); }

.spinner {
  width: 12px; height: 12px; border-radius: 999px;
  border: 2px solid rgba(255,255,255,0.35); border-top-color: white;
  animation: spin 700ms linear infinite;
}

/* --------------------------------- thread -------------------------------- */
.thread { display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 24px)); padding: 0 10px 10px; }
.thread-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 0 8px; border-bottom: 1px solid var(--border);
}
.thread-heading { display: flex; align-items: center; gap: 6px; min-width: 0; }
.thread-number { color: var(--text-muted); font-weight: 600; font-size: 12px; }
.thread-source { color: var(--text-muted); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread-tools { display: flex; gap: 2px; flex: none; }
.icon-button {
  width: 26px; height: 26px; border-radius: 6px;
  display: grid; place-items: center; color: var(--text-muted);
  text-decoration: none;
}
.icon-button:hover { background: var(--bg-hover); color: var(--text); }

.messages { overflow-y: auto; padding: 10px 2px; display: flex; flex-direction: column; gap: 10px; min-height: 40px; }
.message { max-width: 100%; word-break: break-word; }
.message-user {
  align-self: flex-end; max-width: 88%;
  background: var(--bg-hover); padding: 7px 10px; border-radius: 10px 10px 3px 10px;
  white-space: pre-wrap;
}
.message-assistant { color: var(--text); }
.caret { display: inline-block; width: 7px; height: 14px; background: var(--accent); vertical-align: -2px; margin-left: 2px; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }

.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p, .md ul, .md ol, .md pre { margin: 0 0 8px; }
.md ul, .md ol { padding-left: 18px; }
.md .md-heading { font-weight: 600; }
.md code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(255,255,255,0.07); padding: 1px 4px; border-radius: 4px; }
.md pre { background: #0a0a0b; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; overflow-x: auto; }
.md pre code { background: none; padding: 0; }
.md a { color: #8fb3ff; }

.status-line {
  display: flex; align-items: center; gap: 8px;
  padding: 0 2px 8px; color: var(--text-muted); font-size: 12px;
}
.status-waiting { color: var(--warn); }
.status-error { color: var(--error); }
.status-line a { margin-left: auto; color: var(--text); }
.stop {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border); color: var(--text);
}
.stop:hover { background: var(--bg-hover); }
.dots { width: 18px; height: 6px; background: radial-gradient(circle, var(--accent) 2.5px, transparent 3px) 0 0 / 6px 6px repeat-x; animation: dots 1s linear infinite; }
@keyframes dots { to { background-position: 6px 0; } }

/* ---------------------------------- inbox --------------------------------- */
.inbox {
  position: fixed; right: 16px; top: 16px; bottom: 84px; width: 340px;
  display: flex; flex-direction: column;
  pointer-events: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
  animation: slide 160ms ease-out;
}
@keyframes slide { from { opacity: 0; transform: translateX(12px); } }
.inbox-header { display: flex; align-items: center; gap: 10px; padding: 10px 10px 8px 14px; border-bottom: 1px solid var(--border); }
.inbox-header strong { font-size: 14px; }
.segmented { display: flex; margin-left: auto; background: var(--bg-elevated); border-radius: 7px; padding: 2px; }
.segmented button { padding: 3px 9px; border-radius: 5px; color: var(--text-muted); font-size: 12px; }
.segmented .active { background: var(--bg-hover); color: var(--text); }
.inbox-filter { display: flex; align-items: center; gap: 6px; padding: 8px 14px; color: var(--text-muted); font-size: 12px; cursor: pointer; }
.inbox-filter input { accent-color: var(--accent); margin: 0; }
.inbox-list { overflow-y: auto; padding: 0 6px 6px; }
.inbox-item { display: flex; gap: 10px; width: 100%; text-align: left; padding: 10px 8px; border-radius: 8px; align-items: flex-start; }
.inbox-item:hover, .inbox-item.active { background: var(--bg-elevated); }
.inbox-item-body { display: grid; gap: 2px; min-width: 0; }
.inbox-item-title { font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.inbox-item-meta { color: var(--text-muted); font-size: 12px; }
.inbox-item-preview { color: var(--text-muted); font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.empty { color: var(--text-muted); padding: 24px 10px; text-align: center; margin: 0; }

/* --------------------------------- toolbar -------------------------------- */
.toolbar-wrap {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none;
}
.toolbar {
  pointer-events: auto;
  display: flex; align-items: center; gap: 2px;
  padding: 4px; border-radius: 999px;
  background: rgba(17, 17, 19, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.toolbar-hint {
  padding: 5px 12px; border-radius: 999px;
  background: rgba(17, 17, 19, 0.92); border: 1px solid var(--border);
  color: var(--text-muted); font-size: 12px; white-space: nowrap;
  box-shadow: var(--shadow);
}
.hint-warn { color: var(--warn); }
.hint-error { color: var(--error); }
.status-dot { position: relative; width: 8px; height: 8px; margin: 0 8px 0 10px; border-radius: 999px; background: var(--text-muted); }
.status-ok { background: var(--ok); }
.status-warn { background: var(--warn); }
.status-error { background: var(--error); }
.status-ping { position: absolute; inset: -3px; border-radius: 999px; border: 2px solid var(--accent); animation: ping 1.2s ease-out infinite; }
@keyframes ping { to { transform: scale(1.9); opacity: 0; } }
.divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }
.tool {
  position: relative; height: 32px; min-width: 32px; padding: 0 9px;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  border-radius: 999px; color: var(--text-muted);
}
.tool:hover { background: var(--bg-hover); color: var(--text); }
.tool-active { background: var(--accent); color: white; }
.tool-active:hover { background: var(--accent); color: white; }
.tool-active kbd { background: rgba(255,255,255,0.2); color: white; }
.tool-label { font-weight: 550; }
.badge {
  position: absolute; top: 2px; right: 0;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
  background: var(--accent); color: white; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center;
}

.toast {
  position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%);
  max-width: 480px; padding: 8px 14px; border-radius: 10px;
  background: #2a1214; border: 1px solid rgba(229, 72, 77, 0.45); color: #ffb3b5;
  pointer-events: auto; box-shadow: var(--shadow);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;
