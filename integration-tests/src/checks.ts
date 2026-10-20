import type { Action, Snapshot } from './scenario.js';

export function readSnapshot(app: HTMLElement): Snapshot {
  return {
    heading: app.querySelector('h1')?.textContent ?? null,
    history: window.navigation.entries().map(entry => {
      const url = entry.url ? URL.parse(entry.url) : null;
      return url ? url.pathname + url.search + url.hash : '(unavailable)';
    }),
    index: window.navigation.currentEntry?.index ?? -1,
    notes: app.querySelector('input')?.value ?? null,
    transition: window.navigation.transition?.navigationType ?? null,
    title: document.title,
    fingerprint: app.querySelector('[data-instance]')?.getAttribute('data-instance') ?? null,
  };
}

export function mismatches(expected: Partial<Snapshot>, actual: Snapshot): string[] {
  return Object.entries(expected).flatMap(([key, value]) => {
    const received = actual[key as keyof Snapshot];
    return JSON.stringify(value) === JSON.stringify(received) ? [] : [
      `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(received)}`,
    ];
  });
}

export function actionTarget(app: HTMLElement, action?: Action): HTMLElement | undefined {
  if (!action) return;
  if ('fill' in action) {
    return Array.from(app.querySelectorAll('input')).find(input =>
      Array.from(input.labels ?? []).some(label => label.textContent?.trim() === action.fill));
  }
  const name = 'link' in action ? action.link : action.button;
  return Array.from(app.querySelectorAll<HTMLElement>('link' in action ? 'a' : 'button'))
    .find(element => element.textContent?.trim() === name);
}

// Autoplay uses DOM events. Playwright deliberately uses real input instead.
export function performAction(app: HTMLElement, action: Action) {
  const target = actionTarget(app, action);
  if (!target) throw new Error(`Cannot find the target for ${JSON.stringify(action)}`);
  if ('fill' in action && target instanceof HTMLInputElement) {
    target.value = action.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    target.click();
  }
}
