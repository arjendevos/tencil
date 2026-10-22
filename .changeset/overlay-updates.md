---
"tencil": minor
---

The daemon looks for a new Tencil on start and about once a day, and the overlay's settings show the running version. When a newer one is out, they say so (with a dot on the settings button) and offer **Update**: the daemon installs it into its runtime copy, waits for running threads to finish and restarts on it, through the login service or in the background. If the new version doesn't start, the old one keeps running and the overlay shows why, with `npx tencil@latest setup` to copy. `TENCIL_NO_UPDATE_CHECK=1` (and CI) turns the checks off.
