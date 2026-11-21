import { createRoot, getOwner, runWithOwner } from "solid-js";

// Capture a scope to re-enter across awaits, and keep its public disposer.
export function createSolidRoot(parent = getOwner()) {
  return runWithOwner(parent, () => createRoot(dispose => ({ owner: getOwner()!, dispose })));
}
