# Testing utilities

Private, source-only Solid UI diagnostics shared by `example-app` and
`integration-tests`. No router or Playwright dependency. The consuming app's Vite
Solid plugin compiles the TSX; `pnpm --filter @kinetic-router/testing-utils build`
only type-checks it.

```tsx
import { Fingerprint } from '@kinetic-router/testing-utils/fingerprint.js';

// Inside a page's rendered content:
<Fingerprint />
```

Import the shared styles once from the app's CSS entry point:

```css
@import '@kinetic-router/testing-utils/fingerprint.css';
```

Each badge captures its creation time, a unique instance number, and a colorful
pattern once, not on every parameter update. A cached page retains its badge and
native border animation. A new rendered instance gets a new badge, even within
the same millisecond. The timestamp is not a live clock; hover for its full value.

The ten-second border animation respects reduced motion (including changes while
the app is open), and its listener and animation are cleaned up with the Solid
owner. Apart from per-instance CSS variables, styling lives in `fingerprint.css`.
