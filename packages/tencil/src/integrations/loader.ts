/** Port of the Tencil daemon unless configured otherwise. */
export const DEFAULT_DAEMON_PORT = 4747;

/**
 * Browser code that loads the overlay from the daemon on the machine serving
 * the page: `localhost:4747` for a local dev server, `devbox:4747` for one
 * opened as http://devbox:3000. The daemon always speaks plain HTTP.
 *
 * `root` is the repository the dev server runs in; the daemon uses it to find
 * the page's project when no Node process in that folder serves the page
 * (Laravel on Sail or Herd, a backend behind a proxy).
 */
export function overlayLoader(port: number = DEFAULT_DAEMON_PORT, root?: string): string {
    const query = root ? `?root=${encodeURIComponent(root)}` : '';
    return `;(() => {
  if (typeof document === "undefined") return;
  const src = "http://" + location.hostname + ":${Number(port)}/tencil.js${query}";
  if (document.querySelector('script[src="' + src + '"]')) return;
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
})();`;
}
