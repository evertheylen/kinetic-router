#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
engine=${CONTAINER_ENGINE:-}
if [[ -z "$engine" ]]; then
  if command -v podman >/dev/null; then engine=podman
  elif command -v docker >/dev/null; then engine=docker
  else echo 'Install Podman or Docker to run the browser tests.' >&2; exit 1
  fi
fi

# Match the locked @playwright/test version. The check inside the container catches
# drift before tests run; no host browser libraries or custom image build are used.
playwright_version=1.65.1
image="mcr.microsoft.com/playwright:v${playwright_version}-noble"
workspace_id=$(printf '%s' "$root" | cksum | cut -d ' ' -f 1)
prefix="kinetic-lifecycle-${workspace_id}"

# Empty mount points only: the volumes hide host dependencies/build output, while
# the rest of the checkout is read-only. Each worktree gets its own module volumes.
mkdir -p "$root/node_modules" "$root/lifecycle/node_modules" "$root/animations/node_modules" \
  "$root/layout/node_modules" "$root/lifecycle/demo/dist"
# The quoted script deliberately expands variables inside the container.
# shellcheck disable=SC2016
container=$("$engine" create --init --ipc=private --shm-size=1g --workdir /work \
  --mount "type=bind,source=$root,target=/work,readonly" \
  --mount "type=volume,source=$prefix-root-modules,target=/work/node_modules" \
  --mount "type=volume,source=$prefix-lifecycle-modules,target=/work/lifecycle/node_modules" \
  --mount "type=volume,source=$prefix-animations-modules,target=/work/animations/node_modules" \
  --mount "type=volume,source=$prefix-layout-modules,target=/work/layout/node_modules" \
  --mount "type=volume,source=$prefix-demo,target=/work/lifecycle/demo/dist" \
  --mount "type=volume,source=kinetic-lifecycle-package-cache,target=/cache" \
  --env CI=true \
  --env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 --env "PLAYWRIGHT_VERSION=$playwright_version" \
  --env "LIFECYCLE_DEV=${LIFECYCLE_DEV:-}" \
  "$image" bash -lc '
    set -euo pipefail
    mkdir -p /results
    # The Playwright image ships npm but no longer includes Corepack.
    npm install --global --ignore-scripts --cache /cache/npm pnpm@12.21.0
    pnpm --filter @kinetic-router/animations... --filter @kinetic-router/layout... install --frozen-lockfile --store-dir=/cache/pnpm-store
    actual=$(node -p "require(\"./lifecycle/node_modules/@playwright/test/package.json\").version")
    if [[ "$actual" != "$PLAYWRIGHT_VERSION" ]]; then
      echo "Playwright $actual requires a matching image; update playwright_version in test-browser-container.sh." >&2
      exit 1
    fi
    if [[ -z "$LIFECYCLE_DEV" ]]; then pnpm --filter @kinetic-router/lifecycle build:demo; fi
    pnpm --filter @kinetic-router/lifecycle exec playwright test --workers=2 --output=/results "$@"
  ' bash "$@")
trap '"$engine" rm --force "$container" >/dev/null' EXIT

status=0
"$engine" start --attach "$container" || status=$?
# Copy instead of bind-mounting results so rootful Docker does not create root-owned
# files in the checkout. Preserve the test exit status, including on failures.
results="$root/lifecycle/test-results/container"
mkdir -p "$results"
"$engine" cp "$container:/results/." "$results/"
printf 'Browser artifacts: %s\n' "$results"
exit "$status"
