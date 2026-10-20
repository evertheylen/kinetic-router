# Integration tests and manual scenarios

A private playground for testing the real router and Navigation API. All advanced
test infrastructure lives here; `example-app` remains an independent minimal demo.
There is no reporting server or HTTP control bridge.

## Run from the repository root

```sh
pnpm -w run dev:integration          # build libraries, start the playground at localhost:5173
pnpm -w run test:browser             # build, type-check, run Playwright against the production app
pnpm -w run test:browser --headed    # watch trusted Playwright input
pnpm -w run test:browser --ui        # Playwright's interactive runner
pnpm -w test                        # existing Vitest suite
```

Once, download Chromium with:

```sh
pnpm --filter @kinetic-router/integration-tests exec playwright install chromium
```

On supported Linux CI images use `playwright install --with-deps chromium` for
system libraries too. On Arch Linux, missing runtime libraries can be installed
with `sudo pacman -Syu --needed at-spi2-core libxcomposite libxdamage libxrandr libxkbcommon`.
Failure traces and screenshots are kept under `integration-tests/test-results/`.

## Manual mode

Open the playground and select a scenario. Each opens in a fresh top-level tab:
no iframe, no scenario picker mixed into its history. For a restart, open another
fresh tab from the picker; reloading does **not** clear existing browser history.
The chosen scenario survives URL normalization and reloads in session storage.

- Each step gets its instruction from the action, with a short note only for
  non-obvious behavior. The expected and actual stacks mark their current entries.
  Raw snapshots live under Technical details.
- The next link, button, or input has an amber outline and a nearby instruction.
  Interact with it normally: checks run **automatically**, without another button press.
  Typing is only checked once the requested value is complete.
- Disable **Check automatically** to verify each step with **Check step** instead.
  Fresh URLs can opt into this mode with `&checks=manual` (used by the manual-check tests).
- **Run step** performs that action and checks it for you.
- **Autoplay** runs the remaining steps, pausing briefly between them for readability.
  **Stop autoplay** stops after the current check. If automatic checks are disabled,
  check any action you've already done before switching to autoplay, to avoid doing it twice.
- Settled mismatches fail immediately. Checks wait only while setup, navigation,
  or rendering is pending, with a three-second safety timeout. A red ❌ banner
  shows failures with expected/actual differences; the step stays available for retry.
  Successful completion shows a green ✅ banner.
- The full plan, next expectation, live history/current index, page contents, and
  native `navigation.transition` state are visible alongside the page.

Autoplay uses synthetic DOM clicks/input; it cannot replace testing real gestures
or trusted input. Playwright runs the same steps using real browser input. Neither
runner fakes navigation, history, or rendering.

## Read or add a scenario

Start with `src/scenarios/replace.ts`. Each small file contains its real route
setup, actions, and expectations together. Register new scenarios in
`src/scenarios/index.ts`; they automatically appear in the picker and Playwright.
Setup runs only in the browser; its JSX helpers are imported lazily so Playwright
can read the action/expectation plan in Node without loading browser components.

`history: ['/home', '/account'], index: 0` means Home is current and Account is
available in forward history. Expectations only compare fields you specify.
Instructions come from the action; add an optional, short `intent` only for
non-obvious behavior.
`simplePage` provides a heading, a Notes input, named links, and a page fingerprint;
custom router page implementations work as well.

The fingerprint is created once per rendered page instance: local `HH:MM:SS`, an
instance number, and a pattern seeded by the full creation timestamp. Monotonic
millisecond seeds distinguish quick renders even within the same second. Cached
pages retain the same badge and the same native border animation, which loops
every ten seconds and is disabled when reduced motion is preferred. Hover the
badge for the full timestamp. This is instance identity, not a live clock.

The slow-render scenario uses a promise and a Finish rendering button, so you can inspect a committed but unfinished navigation
without timing guesses. It is not yet a visual-animation test.

Shared setup and verification are in `src/pages.tsx` and `src/checks.ts`. The UI is
in `src/main.tsx`; the small Playwright driver is in `tests/scenarios.e2e.ts`.
No library-private router fields are inspected.

`pnpm --filter @kinetic-router/integration-tests test` runs the package directly
if the app/libraries have already been built. Use the root command otherwise.
