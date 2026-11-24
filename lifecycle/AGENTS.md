# Lifecycle prototype

- Keep `README.md` to usage and runnable commands. Public contracts belong beside
  exports in `src/scope.ts`, `src/flow.ts`, and `../motion/src/`; avoid duplicating
  them here or preserving investigation history.
- Retain inputs to Solid's real control flow (`src/retain.ts`), not detached DOM
  snapshots. Solid 2 owners are attached to their parents; `onCleanup` cannot defer
  disposal. A context wrapper cannot intercept an ordinary Show/For's removal.
- Preserve independent boundaries: ancestor removal must not start child exits or
  wait for unrelated nested scopes. Keep this package independent of router state.
- Use Solid's committed render/effect phases, not a parallel microtask/flush
  scheduler. Promise completions invalidate work; they must not prune directly.
- Animation changes must preserve pre-insertion styling, cancellation, and retained
  exit endpoints. Use browser interpolation only, never per-frame JS or layout
  property animations in the WAAPI keyframe helper. CSS adapters may delegate layout
  interpolation to the browser, never per-frame JavaScript. Examples live in
  `demo/main.tsx` and `demo/style.css`.

## Validation

- Read `src/lifecycle.test.tsx` before changing scheduling/ownership. Use native
  `onSettled`/`until` for async tests rather than counting promise turns.
- From the repo root: `pnpm --filter @kinetic-router/lifecycle test` and
  `pnpm --filter @kinetic-router/lifecycle build`.
- Animation behavior needs real-browser checks in `browser/animations.e2e.ts`,
  not only happy-dom. Run `test:browser` and `test:browser:dev` through the same
  package filter; `--project=chromium` can limit a host with missing dependencies.
- Prefer `test:browser:container` for all three browsers. `test-browser-container.sh`
  uses an official prebuilt image, read-only source, and cached dependency volumes.
  Keep its image version aligned with the lockfile; its runtime check rejects drift.
  Do not add image rebuilds or share host `node_modules` with the container.
- For native runs, a global/AUR Playwright install does not replace the workspace
  dependency or rebuild browsers. Inspect actual shared-library requirements;
  never downgrade system libraries or fake incompatible SONAME symlinks.
