#!/bin/bash

set -euo pipefail

# 1. Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Error: Working directory is not clean. Please commit or stash your changes."
  exit 1
fi

pnpm -r clean
pnpm -r build

# 2. Ensure 'published' branch exists (creates it if it doesn't)
if ! git show-ref --verify --quiet refs/heads/published; then
  echo "?? 'published' branch not found. Creating it from current HEAD..."
  git branch published
fi

# 3. Identify changed packages and their dependents
# The filter "...[published]" finds everything changed since that branch
# plus any packages that depend on the changed ones.
FILTER="...[published]"
EXCLUSIONS="--filter !example-app"
CHANGED=$(pnpm ls --filter "$FILTER" $EXCLUSIONS --depth -1 --json)

if [ "$CHANGED" == "[]" ] || [ -z "$CHANGED" ]; then
  echo "✅ No changes detected since the last publish."
  exit 0
fi

echo "📦 Changes detected. Bumping versions and publishing..."

# 4. Bump versions only for the affected scope
# This will update package.json files locally
pnpm --filter "$FILTER" $EXCLUSIONS -r exec pnpm version patch

# 5. Commit the version bumps to your current branch
git add .
git commit -m "chore: version bump for release"

# 6. Publish the changed packages
# --no-git-checks is used because we just made a commit locally
pnpm --filter "$FILTER" $EXCLUSIONS -r exec pnpm publish --no-git-checks --access public

# 7. Update the 'published' branch to the current commit
git branch -f published HEAD

echo "🚀 Successfully published and updated 'published' branch."
