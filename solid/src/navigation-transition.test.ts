import { expect, it, vi } from 'vitest';
import { route } from '@kinetic-router/definition';
import { AppState } from './app-state.js';
import type { PreparedNavigation } from './actual-router.js';
import { NavigationTransition } from './navigation-transition.js';
import { PreparationRegistry } from './preparation-registry.js';

function output(): PreparedNavigation {
  return {
    routes: [], reusedCount: 0, signal: new AbortController().signal,
    adopt: vi.fn(), setRequested: vi.fn(), dispose: vi.fn(),
  };
}

it.each(['host', 'superseded'] as const)('releases only its own interest on %s cancellation', async cancellation => {
  const to = AppState.fromLocator(route({}).locate({}));
  const registry = new PreparationRegistry({ maxEntries: 0 });
  const prepared = output();
  const peer = registry.acquire(to, undefined, async () => prepared)!;
  const host = new AbortController();
  const transition = new NavigationTransition([], to, { signal: host.signal });
  const build = vi.fn(async () => output());
  try {
    expect(transition.to).toBe(to);
    expect(await transition.prepare(registry, build)).toBe(await peer.ready);
    expect(build).not.toHaveBeenCalled();

    if (cancellation === 'host') host.abort(new Error('host cancelled'));
    else transition.abort();
    expect(transition.signal.aborted).toBe(true);
    if (cancellation === 'host') expect(transition.signal.reason).toBe(host.signal.reason);
    expect(prepared.dispose).not.toHaveBeenCalled();
    peer.release();
    expect(prepared.dispose).toHaveBeenCalledOnce();
    transition.dispose();
    expect(prepared.dispose).toHaveBeenCalledOnce();
  } finally {
    transition.dispose();
    registry.dispose();
  }
});

it('owns forced construction directly and releases it exactly once', async () => {
  const to = AppState.fromLocator(route({}).locate({}));
  const registry = new PreparationRegistry();
  const acquire = vi.spyOn(registry, 'acquire');
  const transition = new NavigationTransition([], to, { forceNewInstance: true });
  const prepared = output();
  const build = vi.fn(async () => prepared);
  try {
    expect(await transition.prepare(registry, build)).toBe(prepared);
    expect(acquire).not.toHaveBeenCalled();
    expect(build).toHaveBeenCalledWith([], transition.signal);
    transition.dispose();
    transition.dispose();
    expect(prepared.dispose).toHaveBeenCalledOnce();
  } finally {
    transition.dispose();
    registry.dispose();
  }
});

it('does not start replacement construction if discarding incompatible preparation cancels the transition', async () => {
  const to = AppState.fromLocator(route({}).locate({}));
  const registry = new PreparationRegistry({ maxEntries: 0 });
  const transition = new NavigationTransition([], to);
  // Simulates output prepared under a parent that this navigation cannot reuse.
  const incompatible = { ...output(), reusedCount: 1, dispose: vi.fn(() => transition.abort()) };
  const peer = registry.acquire(to, undefined, async () => incompatible)!;
  const build = vi.fn(async () => output());
  try {
    await peer.ready;
    await expect(transition.prepare(registry, build)).rejects.toMatchObject({ name: 'AbortError' });
    expect(build).not.toHaveBeenCalled();
    expect(incompatible.dispose).toHaveBeenCalledOnce();
  } finally {
    transition.dispose();
    peer.release();
    registry.dispose();
  }
});

it('rejects and releases a direct result that arrives after cancellation', async () => {
  const to = AppState.fromLocator(route({}).locate({}));
  const registry = new PreparationRegistry();
  const transition = new NavigationTransition([], to, { forceNewInstance: true });
  const ready = Promise.withResolvers<PreparedNavigation>();
  const prepared = output();
  const pending = transition.prepare(registry, () => ready.promise);
  try {
    transition.abort();
    ready.resolve(prepared);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    transition.dispose();
    expect(prepared.dispose).toHaveBeenCalledOnce();
  } finally {
    transition.dispose();
    registry.dispose();
  }
});
