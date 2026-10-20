import { expect, it, vi } from 'vitest';
import { createEffect, createOwner, flush, runWithOwner } from 'solid-js';
import { createPageLifecycle } from './rendered-route.js';

it('does not invalidate resource or visibility readers when unrelated lifecycle fields change', () => {
  const owner = createOwner();
  const lifecycle = runWithOwner(owner, createPageLifecycle);
  const readFetch = vi.fn(() => lifecycle.status.fetchSignal());
  const readVisible = vi.fn(() => lifecycle.status.isVisible());
  runWithOwner(owner, () => {
    createEffect(readFetch, () => {});
    createEffect(readVisible, () => {});
  });
  try {
    flush();
    expect(readFetch).toHaveBeenCalledOnce();
    lifecycle.setState('active', true);
    flush();
    expect(readFetch).toHaveBeenCalledOnce();
    expect(readVisible).toHaveBeenCalledTimes(2);
    lifecycle.setState('active');
    flush();
    expect(readFetch).toHaveBeenCalledOnce();
    expect(readVisible).toHaveBeenCalledTimes(2);
    lifecycle.setState('active');
    flush();
    expect(readFetch).toHaveBeenCalledOnce();
    expect(readVisible).toHaveBeenCalledTimes(2);
  } finally { owner.dispose(); }
});

it('reactively tracks preparation, focus, retention, resumption and terminal disposal', () => {
  const owner = createOwner(), observer = createOwner();
  const lifecycle = runWithOwner(owner, createPageLifecycle);
  const status = lifecycle.status;
  const snapshots: unknown[] = [];
  runWithOwner(observer, () => createEffect(
    () => [status.shouldFetch(), status.isVisible(), status.hasFocus(), status.fetchSignal()],
    value => { snapshots.push(value); },
  ));
  try {
    flush();
    const initial = status.fetchSignal()!;
    const aborted = vi.fn();
    initial.addEventListener('abort', aborted);
    expect(snapshots.at(-1)).toEqual([true, false, false, initial]);
    expect(initial.aborted).toBe(false);
    expect(status.isAnimating()).toBe(false);

    lifecycle.setState('active', true);
    flush();
    expect(snapshots.at(-1)).toEqual([true, true, true, initial]);
    lifecycle.setState('active');
    flush();
    expect(snapshots.at(-1)).toEqual([true, true, false, initial]);

    // Even retention and resumption within one Solid batch renew the signal.
    lifecycle.setState('retained');
    lifecycle.setState('preparing');
    flush();
    const resumed = status.fetchSignal()!;
    expect(resumed).not.toBe(initial);
    expect(resumed.aborted).toBe(false);
    expect(aborted).toHaveBeenCalledOnce();

    lifecycle.setState('retained');
    flush();
    expect(resumed.aborted).toBe(true);
    expect(snapshots.at(-1)).toEqual([false, false, false, undefined]);
    lifecycle.setState('active', true);
    flush();
    const active = status.fetchSignal()!;
    expect(active).not.toBe(resumed);
    expect(active.aborted).toBe(false);

    owner.dispose();
    owner.dispose();
    lifecycle.setState('active', true);
    flush();
    expect(active.aborted).toBe(true);
    expect(snapshots.at(-1)).toEqual([false, false, false, undefined]);
    expect(aborted).toHaveBeenCalledOnce();
  } finally {
    owner.dispose();
    observer.dispose();
  }
});
