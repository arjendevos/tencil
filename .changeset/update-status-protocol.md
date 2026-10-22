---
"@tencildev/protocol": minor
"@tencildev/bridge": minor
"@tencildev/testing": minor
---

Updates: `ready` can carry an `UpdateStatus` (`update`), pushed again as an `update` message, and the overlay sends `update.start`. The bridge takes an `update` option for it; without one (Tencil Cloud) it leaves the field out and refuses `update.start`. `@tencildev/testing` adds `FakeRegistry`, a stand-in npm registry.
