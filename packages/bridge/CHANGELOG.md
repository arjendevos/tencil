# @tencildev/bridge

## 0.3.0

### Minor Changes

- [#6](https://github.com/tencildev/tencil/pull/6) [`25749e6`](https://github.com/tencildev/tencil/commit/25749e6d21588ab8a149525e2b957701f1a7c5a6) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Measure spacing in the overlay. While picking, the hovered element shows its padding, margin and flex or grid gap with their values (and the Tailwind class that sets them). Hold Alt to see the distances to its parent, or, with a comment open, to any other element; Alt-click to send those distances with the comment. With the ruler on, it also works outside comment mode: hold Alt (Option on a Mac) anywhere to measure, Alt-click to select an element to measure from, and press C to comment on it with that spacing. The ruler button in the toolbar, or `R`, turns this on (it starts off), and the project setting `ruler` (on by default) hides it altogether. Pins now carry the element's box model (`ElementContext.box`) and any measured spacing (`ElementContext.spacing`), and the bridge puts both in the prompt.

### Patch Changes

- Updated dependencies [[`25749e6`](https://github.com/tencildev/tencil/commit/25749e6d21588ab8a149525e2b957701f1a7c5a6)]:
  - @tencildev/protocol@0.3.0

## 0.2.0

### Minor Changes

- [#21](https://github.com/tencildev/tencil/pull/21) [`1ead5ab`](https://github.com/tencildev/tencil/commit/1ead5ab4b67f611d25b83b3383a3a59391354ad0) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - What Tencil Cloud needs from the wire and the bridge. The protocol gains the build a cloud preview reports (`BuildInfo`), sign-in (`auth.required`, `CloudSignIn`, `Viewer`), a run's delivery (`Delivery`: queued, pushed, deploying, live) and its steps (`ThreadStep`), and `ThreadSink.delivery` and `ThreadSink.step`. The bridge stores and broadcasts delivery and steps on a provider thread's pins, starts a turn's steps afresh on a reply, and keeps page content from closing the prompt's context block.

### Patch Changes

- Updated dependencies [[`1ead5ab`](https://github.com/tencildev/tencil/commit/1ead5ab4b67f611d25b83b3383a3a59391354ad0)]:
  - @tencildev/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#15](https://github.com/tencildev/tencil/pull/15) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First npm release of the packages behind Tencil's daemon: `@tencildev/protocol` (wire schemas and the `Provider` interface), `@tencildev/bridge` (pins, prompt rendering and provider wiring, with storage and provider creation injectable) and `@tencildev/testing` (a fake provider, a fake T3 Code server and a fake Claude Agent SDK).

### Patch Changes

- Updated dependencies [[`de32e5f`](https://github.com/tencildev/tencil/commit/de32e5f59d5fe626af290350219c5a23ef340f59)]:
  - @tencildev/protocol@0.1.0
