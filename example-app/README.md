# Example app

```sh
pnpm --filter @kinetic-router/example-app... -r build
pnpm --filter @kinetic-router/example-app dev
```

Open http://localhost:3000 in a browser with the Navigation API.
`pnpm --filter @kinetic-router/example-app build` type-checks and builds the demo.

- Components import `Link` from `@kinetic-router/solid/link.js`; the Router created
  in `src/routing.ts` supplies navigation and defaults automatically.
- App-level module updates reload the page so the Router and root Frame are
  recreated together, rather than leaving cached pages in a replaced outlet.
- Prefetch is enabled in `src/routing.ts`: hover/focus wait 75 ms, primary press
  starts immediately, and data-saving preferences are respected.
- Account and Todos are lazy-loaded. Hover or keyboard-focus their menu links to
  load and prepare them without changing the visible page or history.
- Todos (`/todos`) uses `Lifecycle.For` for tumbling task cards and `Lifecycle.Show`
  for a confetti-filled empty state. Complete a task, then quickly Undo: its exit
  reverses and its victory-note input survives. Complete all for maximum fanfare.
  The animations package's `createCssTransition` helper animates CSS grid wrappers, so cards, their
  spacing, and the empty banner expand/collapse without a disposal jump. The grid
  content stays overflow-visible, so tumbling cards aren't clipped by their shrinking
  slots; exiting items float above neighbours. No manual sizing or per-frame
  JavaScript. Motion respects reduced-motion preferences;
  cached pages retain their list.
  Run `pnpm --filter @kinetic-router/example-app test:browser` for the Chromium
  checks (install it first with `pnpm --filter @kinetic-router/example-app exec playwright install chromium`).
- Main navigation uses `mode="menu"`. Visit Agencies → NMBS → Home, then select
  Agencies to resume NMBS. Select Agencies again to return to the list.
- Agency links demonstrate inherited options (NMBS), a 150 ms hover override
  (DB), and disabled prefetch (ÖBB). DB's press/focus settings remain inherited.
- Colorful fingerprints identify rendered page instances, including the layout
  and its nested content. Cached pages keep their badge and ten-second border
  animation; the animation respects reduced motion. Shared code and styles live
  in the private `@kinetic-router/testing-utils` package.
- Account notes demonstrate cached DOM state. Its return link uses
  `mode="replace"`; ordinary menu navigation and Back/Forward retain history.
