
export function printNavigationState() {
  console.debug("------ navigation status ------");
  for (const entry of window.navigation.entries()) {
    console.debug(`${entry.index}\t id=${entry.id}\t key=${entry.key}\t url=${entry.url}`);
  }
  console.debug("------------");
}
