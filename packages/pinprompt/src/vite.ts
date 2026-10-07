import type { PinpromptInstance, PinpromptOptions } from "./index.ts";
import { DEFAULT_PORT, startPinprompt } from "./index.ts";

/** Structural subset of Vite's Plugin type, so `vite` stays an optional peer. */
interface VitePlugin {
  name: string;
  apply: "serve";
  configureServer(server: {
    httpServer: { once(event: "close", cb: () => void): void } | null;
  }): Promise<void>;
  transformIndexHtml(): Array<{
    tag: string;
    attrs: Record<string, string | boolean>;
    injectTo: "body";
  }>;
}

export interface PinpromptViteOptions extends PinpromptOptions {
  /**
   * Start the bridge inside the Vite process (default). Set to false when you
   * run `pinprompt` yourself and only want the script injected.
   */
  startBridge?: boolean;
}

/**
 * Dev-only: injects the overlay script and (by default) runs the bridge
 * alongside the Vite dev server.
 */
export default function pinprompt(options: PinpromptViteOptions = {}): VitePlugin {
  const { startBridge = true, ...bridgeOptions } = options;
  const port = bridgeOptions.port ?? DEFAULT_PORT;
  let instance: PinpromptInstance | undefined;

  return {
    name: "pinprompt",
    apply: "serve",
    async configureServer(server) {
      if (!startBridge) return;
      try {
        instance = await startPinprompt({
          ...bridgeOptions,
          port,
          log: bridgeOptions.log ?? ((message) => console.log(`[pinprompt] ${message}`)),
        });
      } catch (error) {
        // Most likely a standalone bridge is already running; reuse it.
        console.warn(`[pinprompt] ${error instanceof Error ? error.message : String(error)}`);
      }
      server.httpServer?.once("close", () => void instance?.close());
    },
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { src: `http://localhost:${port}/pinprompt.js`, defer: true },
          injectTo: "body",
        },
      ];
    },
  };
}
