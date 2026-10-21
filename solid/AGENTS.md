# Solid router contracts

Public API contracts belong beside the exported types in `src/link.ts`,
`src/router.ts`, `src/actual-router.ts`, and `src/page.ts`, not in the root README.
Check `src/link.test.ts` and `../integration-tests/tests/link.e2e.ts` before
changing interaction semantics.

- Run caller Link handlers before internal actions and honor `preventDefault()`.
  Modified clicks, other targets, and downloads must retain native behavior.
- Keep hover, keyboard/assistive focus, and press interests independent. A normal
  touch release retains press interest for up to 400 ms awaiting click; an
  abandoned gesture releases it. Configuration/destination changes and unmounting
  release obsolete interests immediately, regardless of `cancelDelay`.
- Respect `navigator.connection?.saveData` for speculation, never actual navigation.
  Preference changes cancel disallowed work and restart ongoing hover/focus delays
  when lifted. Missing APIs and slow `effectiveType` values do not suppress work;
  `respectSaveData: false` must not bypass disabled triggers.
- Backstage preparation must not alter history, live frames/parameters, title,
  scroll, or focus. Equivalent destinations share work and resolved defaults,
  including hidden values. No-op destinations need no preparation.
- Navigation takes ownership before Link cleanup releases its interest. Other
  consumers retain their fetching interests after adoption, even when output is
  offscreen or evicted from history. See `src/preparation-registry.ts` and
  `../integration-tests/tests/preparation.e2e.ts` for ownership boundaries.
- Cache eviction must retain complete ancestor stacks and protect visible output.
  History and saved parameters/scroll positions survive eviction; local DOM state
  does not. Test cache changes in `src/preparation.test.ts` and `src/router.test.ts`.
