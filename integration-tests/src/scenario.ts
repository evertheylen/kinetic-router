import type { Route } from '@kinetic-router/definition';
import type { RootSitemap } from '@kinetic-router/definition/root.js';
import type { Page } from '@kinetic-router/solid/page.js';

export type Action =
  | { link: string }
  | { button: string }
  | { fill: string, value: string };

export type Snapshot = {
  heading: string | null,
  history: string[],
  index: number,
  notes: string | null,
  transition: NavigationType | null,
  title: string,
  fingerprint: string | null,
};

export type Step = { intent?: string, action?: Action, expect: Partial<Snapshot> };
export type TestPage = Page<{}, {}, never>;
export type Scenario = {
  id: string,
  name: string,
  setup(): Promise<{
    sitemap: RootSitemap,
    pages: [Route<{}>, TestPage][],
    controls?: { label: string, run(): void }[],
  }>,
  steps: Step[],
};

export function instruction(action?: Action): string {
  if (!action) return 'Check the initial page';
  if ('link' in action) return `Click the “${action.link}” link`;
  if ('button' in action) return `Click the “${action.button}” button`;
  return `Enter “${action.value}” in ${action.fill}`;
}
