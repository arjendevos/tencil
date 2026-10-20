---
'tencil': minor
'@tencildev/protocol': minor
'@tencildev/bridge': minor
---

Measure spacing in the overlay. While picking, the hovered element shows its padding, margin and flex or grid gap with their values (and the Tailwind class that sets them). Hold Alt to see the distances to its parent, or, with a comment open, to any other element; Alt-click to send those distances with the comment. Pins now carry the element's box model (`ElementContext.box`) and any measured spacing (`ElementContext.spacing`), and the bridge puts both in the prompt.
