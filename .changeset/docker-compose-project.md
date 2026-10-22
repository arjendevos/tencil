---
'tencil': patch
---

Find the project of a dev server running in Docker. When a page's port is published by Docker (Docker Desktop, docker-proxy, OrbStack, Colima, Podman), the daemon asks Docker for the compose project's folder instead of showing the project picker.
