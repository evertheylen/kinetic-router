# Example app

```sh
pnpm --filter @kinetic-router/solid... -r build
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
- Account is lazy-loaded. Hover or keyboard-focus its menu link to load and
  prepare it without changing the visible page or history.
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
