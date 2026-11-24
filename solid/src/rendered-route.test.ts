import { expect, it, vi } from 'vitest';
import { route } from '@kinetic-router/definition';
import { usePresenceScope } from '@kinetic-router/presence';
import { createEffect, createSignal, flush, onCleanup, runWithOwner, useContext } from 'solid-js';
import { createParamStorage } from './params.js';
import type { Page, PagePreparationContext } from './page.js';
import { InRenderedRoute, renderRoute, type RenderedRoute } from './rendered-route.js';
import { createSolidRoot } from './utils.js';

it('provides route presence in setup and output without leaking to unrelated owners', async () => {
  const home = route({});
  const unrelated = createSolidRoot();
  let seenContext: RenderedRoute | null = null;
  let setupPresence: ReturnType<typeof usePresenceScope> = null;
  let outputPresence: ReturnType<typeof usePresenceScope> = null;
  const [text, setText] = createSignal('initial');
  const cleanup = vi.fn();
  const implementation: Page<{}> = {
    untrackedKeys: [],
    async render() {
      setupPresence = usePresenceScope();
      return () => {
        seenContext = useContext(InRenderedRoute);
        outputPresence = usePresenceScope();
        const html = document.createElement('div');
        createEffect(text, value => { html.textContent = value; });
        onCleanup(cleanup);
        return { html, title: 'Home' };
      };
    },
  };
  const params = createParamStorage({ route: home, implementation, paramMap: new Map() });
  try {
    const rendered = await renderRoute({
      route: home,
      implementation,
      renderArgs: { params },
      signal: new AbortController().signal,
    });
    expect(seenContext).toBe(rendered);
    expect(setupPresence).not.toBeNull();
    expect(outputPresence).toBe(setupPresence);
    expect(runWithOwner(unrelated.owner, () => useContext(InRenderedRoute))).toBe(null);
    expect(runWithOwner(unrelated.owner, usePresenceScope)).toBeNull();
    flush();
    expect(rendered.renderOutput!.html.textContent).toBe('initial');
    expect(cleanup).not.toHaveBeenCalled();
    setText('updated');
    flush();
    expect(rendered.renderOutput!.html.textContent).toBe('updated');
  } finally {
    params.dispose();
    unrelated.dispose();
  }
  expect(cleanup).toHaveBeenCalledOnce();
});

it('rejects a renderer failure without halting other reactive updates', async () => {
  const definition = route({});
  const failure = new Error('output failed');
  const cleanup = vi.fn();
  const implementation = { untrackedKeys: [], async render() {
    return () => {
      onCleanup(cleanup);
      throw failure;
    };
  } };
  const params = createParamStorage({ route: definition, implementation, paramMap: new Map() });
  const [value, setValue] = createSignal(0);
  const observer = createSolidRoot();
  let observed: number | undefined;
  runWithOwner(observer.owner, () => createEffect(value, current => { observed = current; }));
  try {
    flush();
    expect(observed).toBe(0);
    await expect(renderRoute({ route: definition, implementation, renderArgs: { params }, signal: new AbortController().signal }))
      .rejects.toThrow(failure.message);
    expect(cleanup).toHaveBeenCalledOnce();
    setValue(1);
    flush();
    expect(observed).toBe(1);
  } finally {
    params.dispose();
    observer.dispose();
  }
});

it('skips a pre-cancelled factory and disposes its parameter owner exactly once', async () => {
  const definition = route({});
  const controller = new AbortController();
  const render = vi.fn(async () => () => ({ html: document.createElement('div'), title: '' }));
  const implementation = { untrackedKeys: [], render };
  const params = createParamStorage({ route: definition, implementation, paramMap: new Map() });
  const cleanup = vi.fn();
  runWithOwner(params.owner, () => onCleanup(cleanup));
  controller.abort();
  await expect(renderRoute({ route: definition, implementation, renderArgs: { params }, signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' });
  params.dispose();
  expect(render).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});

it.each(['resolve', 'reject'] as const)('cancels an owned factory before its late %s', async completion => {
  const definition = route({});
  const controller = new AbortController();
  const gate = Promise.withResolvers<void>();
  const cleanup = vi.fn(), output = vi.fn(() => ({ html: document.createElement('div'), title: 'stale' }));
  let context!: PagePreparationContext;
  const implementation: Page<{}> = {
    untrackedKeys: [],
    async render(_params, ctx) {
      context = ctx;
      onCleanup(cleanup);
      await gate.promise;
      return output;
    },
  };
  const params = createParamStorage({ route: definition, implementation, paramMap: new Map() });
  const rendering = renderRoute({ route: definition, implementation, renderArgs: { params }, signal: controller.signal });
  const outcome = rendering.catch((error: unknown) => error);
  const fetching = context.pageStatus.fetchSignal()!;
  expect(context.signal).toBe(controller.signal);
  expect(fetching).not.toBe(controller.signal);
  expect(fetching.aborted).toBe(false);
  expect(context.pageStatus.isVisible()).toBe(false);
  controller.abort();
  flush();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(fetching.aborted).toBe(true);
  expect(context.pageStatus.shouldFetch()).toBe(false);
  const error = new Error('late application failure');
  if (completion === 'resolve') gate.resolve();
  else gate.reject(error);
  const result = await outcome;
  if (completion === 'resolve') expect(result).toMatchObject({ name: 'AbortError' });
  else expect(result).toBe(error);
  params.dispose();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(output).not.toHaveBeenCalled();
});

it('disposes output cancelled synchronously during construction without resurrecting its owner', async () => {
  const definition = route({});
  const controller = new AbortController();
  const cleanup = vi.fn();
  const html = document.createElement('div');
  const implementation: Page<{}> = {
    untrackedKeys: [],
    async render() {
      return () => {
        onCleanup(cleanup);
        controller.abort();
        return { html, title: 'stale' };
      };
    },
  };
  const params = createParamStorage({ route: definition, implementation, paramMap: new Map() });
  const outcome = await renderRoute({ route: definition, implementation, renderArgs: { params }, signal: controller.signal })
    .then(() => 'resolved', (error: Error) => error.name);
  expect(outcome).toBe('AbortError');
  expect(html.parentNode).toBeNull();
  params.dispose();
  expect(cleanup).toHaveBeenCalledOnce();
});
