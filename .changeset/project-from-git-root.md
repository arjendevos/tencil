---
'tencil': patch
'@tencildev/protocol': minor
---

Find a page's project from the repository the Vite plugin or `withTencil` runs in, so pages served by something other than a Node process in the project (Laravel on Sail or Herd, a backend behind a proxy) no longer ask "Which project is this page?". The loader passes the git root (`tencil.js?root=…`), the overlay sends it with `hello` (`root`), and the daemon uses it when it holds a `.git` folder or file, after the address's remembered choice and before the port lookup. In Next.js this needs `withTencil` in `next.config`. The plain `<script>` tag keeps the port lookup.
