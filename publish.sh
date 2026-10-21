#!/bin/bash

set -euo pipefail

# 1. Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Error: Working directory is not clean. Please commit or stash your changes."
  exit 1
fi

# 2. Select changed packages and their dependents, or all packages on first release.
FILTER="*"
if git show-ref --verify --quiet refs/heads/published; then
  FILTER="...[published]"
fi

# Snapshot public package names so the release commit cannot change the selection.
CHANGED=$(pnpm ls --filter "$FILTER" --depth -1 --json | node -e '
  const packages = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  for (const pkg of packages) {
    if (!pkg.private) console.log(pkg.name);
  }
')

if [ -z "$CHANGED" ]; then
  echo "✅ No publishable packages changed since the last publish."
  exit 0
fi

FILTERS=()
while IFS= read -r package; do
  FILTERS+=(--filter "$package")
done <<< "$CHANGED"

# 3. Build before changing versions or history.
pnpm -r clean
pnpm -r build

echo "📦 Changes detected. Bumping versions and publishing..."

# 4. Bump the selected packages together, without per-package commits or tags.
pnpm "${FILTERS[@]}" -r version patch --no-git-tag-version

# 5. Commit the version bumps to your current branch
git add .
git commit -m "chore: version bump for release"

# 6. Publish the changed packages
# --no-git-checks is used because we just made a commit locally
pnpm "${FILTERS[@]}" -r publish --no-git-checks --access public

# 7. Update the 'published' branch to the current commit
git branch -f published HEAD

echo "🚀 Successfully published and updated 'published' branch."
