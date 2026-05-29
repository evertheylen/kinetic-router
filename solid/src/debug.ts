
export function printNavigationState() {
  console.debug("------ navigation status ------");
  console.table(window.navigation.entries().map(e => ({index: e.index, id: e.id, key: e.key, url: e.url})))
}
