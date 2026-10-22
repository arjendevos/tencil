# @tencildev/testing

## 0.2.0

### Minor Changes

- [#10](https://github.com/tencildev/tencil/pull/10) [`f205605`](https://github.com/tencildev/tencil/commit/f2056058b7cb2fed6e3dd8571ace61aadd818c0e) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Updates: `ready` can carry an `UpdateStatus` (`update`), pushed again as an `update` message, and the overlay sends `update.start`. The bridge takes an `update` option for it; without one (Tencil Cloud) it leaves the field out and refuses `update.start`. `@tencildev/testing` adds `FakeRegistry`, a stand-in npm registry.

### Patch Changes

- Updated dependencies [[`ca2b067`](https://github.com/tencildev/tencil/commit/ca2b067663d4ca552fd24d8bf48fbf5f41b29500), [`f205605`](https://github.com/tencildev/tencil/commit/f2056058b7cb2fed6e3dd8571ace61aadd818c0e)]:
  - @tencildev/protocol@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`25749e6`](https://github.com/tencildev/tencil/commit/25749e6d21588ab8a149525e2b957701f1a7c5a6)]:
  - @tencildev/protocol@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`1ead5ab`](https://github.com/tencildev/tencil/commit/1ead5ab4b67f611d25b83b3383a3a59391354ad0)]:
  - @tencildev/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#15](https://github.com/tencildev/tencil/pull/15) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First npm release of the packages behind Tencil's daemon: `@tencildev/protocol` (wire schemas and the `Provider` interface), `@tencildev/bridge` (pins, prompt rendering and provider wiring, with storage and provider creation injectable) and `@tencildev/testing` (a fake provider, a fake T3 Code server and a fake Claude Agent SDK).

### Patch Changes

- Updated dependencies [[`de32e5f`](https://github.com/tencildev/tencil/commit/de32e5f59d5fe626af290350219c5a23ef340f59)]:
  - @tencildev/protocol@0.1.0
