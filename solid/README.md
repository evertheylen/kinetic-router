
# `@kinetic-router/solid`

This is the most important package, as it implements the actual router for Solid SPA apps.

See the repository [README](../README.md) for an overview and a small usage example,
or [example-app](../example-app/) for a working demo. Detailed API contracts are
commented beside the exported types in `src/link.ts`, `src/router.ts`, and `src/page.ts`.

[Dumb SSR and client handoff](docs/dumb-ssr.md) renders public URL-specific HTML
through the separately imported `dumb-ssr.js` entry, then replaces it with a fresh
client render—no hydration or server-state transfer. A production fixture is in
`../integration-tests/src/dumb-ssr/`.

Animated page transitions are not implemented.
