---
'tencil': minor
'@tencildev/protocol': minor
'@tencildev/bridge': minor
---

Measure spacing in the overlay. While picking, the hovered element shows its padding, margin and flex or grid gap with their values (and the Tailwind class that sets them). Hold Alt to see the distances to its parent, or, with a comment open, to any other element; Alt-click to send those distances with the comment. With the ruler on, it also works outside comment mode: hold Alt (Option on a Mac) anywhere to measure, Alt-click to select an element to measure from, and press C to comment on it with that spacing. The ruler button in the toolbar turns this on (it starts off), and the project setting `ruler` (on by default) hides it altogether. Pins now carry the element's box model (`ElementContext.box`) and any measured spacing (`ElementContext.spacing`), and the bridge puts both in the prompt.
