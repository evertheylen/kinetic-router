import { describe, it, expect } from 'vitest';
import { MemoryEngine } from './memory-engine.js';
import { EngineHandlers, EngineNavigateEvent } from './navigation-engine.js';

function mockHandlers() {
  const events: EngineNavigateEvent[] = [];
  const disposed: string[] = [];

  const handlers: EngineHandlers = {
    async handleNavigate(event) {
      events.push(event);
    },
    handleDispose(entryId) {
      disposed.push(entryId);
    },
  };

  return { events, disposed, handlers };
}

function attachedEngine(initialUrl?: string) {
  const engine = new MemoryEngine(initialUrl);
  const mock = mockHandlers();
  engine.attach(mock.handlers);
  return { engine, ...mock };
}

/** Let scheduled microtasks (like dispose callbacks) run. */
const tick = () => new Promise<void>(resolve => setTimeout(resolve));

describe('MemoryEngine', () => {
  it('starts with a single entry for the initial url', () => {
    const engine = new MemoryEngine('/home?q=1');

    expect(engine.entries()).toHaveLength(1);
    expect(engine.currentIndex()).toBe(0);

    const current = engine.currentEntry();
    expect(current.url).toEqual({ pathname: '/home', search: '?q=1' });
    expect(current.getState!()).toBeUndefined();
  });

  it('throws when navigating before attach', () => {
    const engine = new MemoryEngine();
    expect(() => engine.navigate({ url: '/a', state: undefined, history: 'push' }))
      .toThrow(/not attached/);
  });

  it('throws when attached twice', () => {
    const { engine, handlers } = attachedEngine();
    expect(() => engine.attach(handlers)).toThrow(/already attached/);
  });

  it('pushes a new entry and reports a navigate event', async () => {
    const { engine, events } = attachedEngine('/');
    const initialId = engine.currentEntry().id!;

    const res = engine.navigate({ url: '/a', state: { foo: 1 }, history: 'push' });
    const committed = await res.committed;
    await res.finished;

    expect(engine.entries()).toHaveLength(2);
    expect(engine.currentIndex()).toBe(1);
    expect(engine.entries()[1].url).toBe('/a');

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.navigationType).toBe('push');
    expect(event.fromId).toBe(initialId);
    expect(event.committedId).toBe(committed!.id);
    expect(event.destination.getState!()).toEqual({ foo: 1 });
    expect(event.destination.url).toEqual({ pathname: '/a', search: '' });
  });

  it('replaces the current entry and disposes the old one after finishing', async () => {
    const { engine, events, disposed } = attachedEngine('/');
    const initialId = engine.currentEntry().id!;
    const initialKey = engine.currentEntry().key;

    const res = engine.navigate({ url: '/b', state: undefined, history: 'replace' });
    await res.finished;
    await tick();

    expect(engine.entries()).toHaveLength(1);
    expect(engine.currentEntry().id).not.toBe(initialId);
    expect(engine.currentEntry().key).toBe(initialKey);
    expect(engine.entries()[0]).toMatchObject({ key: initialKey, index: 0 });
    expect(events[0].navigationType).toBe('replace');
    expect(disposed).toEqual([initialId]);
  });

  it('swallows navigations with info.ignore (commit without render)', async () => {
    const { engine, events } = attachedEngine('/');

    const res = engine.navigate({ url: '/a', state: 's', history: 'push', info: { ignore: true } });
    await res.finished;

    expect(engine.entries()).toHaveLength(2);
    expect(engine.currentEntry().getState!()).toBe('s');
    expect(events).toHaveLength(0);
  });

  it('traverses back and forward, reporting traverse events', async () => {
    const { engine, events } = attachedEngine('/');
    await engine.navigate({ url: '/a', state: 'a', history: 'push' }).finished;
    const aId = engine.currentEntry().id!;
    await engine.navigate({ url: '/b', state: 'b', history: 'push' }).finished;
    const bId = engine.currentEntry().id!;

    await engine.back().finished;
    expect(engine.currentIndex()).toBe(1);
    expect(engine.currentEntry().id).toBe(aId);

    await engine.forward().finished;
    expect(engine.currentIndex()).toBe(2);
    expect(engine.currentEntry().id).toBe(bId);

    const traverses = events.filter(e => e.navigationType === 'traverse');
    expect(traverses).toHaveLength(2);
    expect(traverses[0].destination.id).toBe(aId);
    expect(traverses[0].fromId).toBe(bId);
    expect(traverses[0].committedId).toBe(aId);
    expect(traverses[1].destination.id).toBe(bId);
  });

  it('throws when traversing out of bounds', () => {
    const { engine } = attachedEngine('/');
    expect(() => engine.back()).toThrow(/no entry at index/);
    expect(() => engine.forward()).toThrow(/no entry at index/);
  });

  it('prunes and disposes forward entries when pushing after a back', async () => {
    const { engine, disposed } = attachedEngine('/');
    await engine.navigate({ url: '/a', state: 'a', history: 'push' }).finished;
    await engine.navigate({ url: '/b', state: 'b', history: 'push' }).finished;
    const bId = engine.currentEntry().id!;

    await engine.back().finished;
    await engine.navigate({ url: '/c', state: 'c', history: 'push' }).finished;
    await tick();

    expect(engine.entries().map(e => e.url)).toEqual(['/', '/a', '/c']);
    expect(disposed).toEqual([bId]);
  });

  it('inspects surviving entries and traverses by key in both directions', async () => {
    const { engine, events } = attachedEngine('/');
    const initial = engine.currentEntry();
    await engine.navigate({ url: '/a', state: 'a', history: 'push' }).finished;
    const a = engine.currentEntry();
    await engine.navigate({ url: '/b', state: 'b', history: 'push' }).finished;
    const b = engine.currentEntry();
    expect(new Set([initial.key, a.key, b.key]).size).toBe(3);
    expect(engine.entries().map(entry => entry.index)).toEqual([0, 1, 2]);
    await engine.traverseTo(initial.key).finished;
    await engine.traverseTo(b.key, { forceNewInstance: true }).finished;
    expect(engine.currentEntry().id).toBe(b.id);
    expect(events.at(-1)?.info).toEqual({ forceNewInstance: true });
    expect(engine.entries()[1].getState?.()).toBe('a');

    const count = events.length;
    await engine.traverseTo(b.key).finished;
    expect(events).toHaveLength(count);
    await engine.traverseTo(a.key).finished;
    await engine.navigate({ url: '/c', state: 'c', history: 'replace' }).finished;
    expect(engine.currentEntry().key).toBe(a.key);
    expect(engine.currentEntry().id).not.toBe(a.id);
    await engine.traverseTo(b.key).finished;
    await engine.traverseTo(a.key).finished;
    expect(engine.currentEntry().url).toEqual({ pathname: '/c', search: '' });
    await engine.navigate({ url: '/d', state: 'd', history: 'push' }).finished;
    expect(() => engine.traverseTo(b.key)).toThrow(/missing key/);
    expect(engine.entries().map(entry => entry.url)).toEqual(['/', '/c', '/d']);
  });

  it('updates the state of the current entry', () => {
    const { engine } = attachedEngine('/');
    engine.updateCurrentEntry({ hello: 'world' });
    expect(engine.currentEntry().getState!()).toEqual({ hello: 'world' });
  });
});
