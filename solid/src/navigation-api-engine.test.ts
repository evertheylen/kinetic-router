import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationApiEngine } from './navigation-api-engine.js';

function entry(id: string, key: string, index: number) {
  return Object.assign(new EventTarget(), { id, key, index, url: `https://example.com/${id}`, getState: () => undefined });
}

function setup() {
  const first = entry('first', 'slot', 0);
  const navigation = Object.assign(new EventTarget(), {
    currentEntry: first,
    entries: () => [first],
    navigate: vi.fn(),
    traverseTo: vi.fn(),
    updateCurrentEntry: vi.fn(),
  });
  vi.stubGlobal('navigation', navigation);
  const handlers = { handleNavigate: vi.fn(async () => {}), handleBeforeCommit: vi.fn(), handleDispose: vi.fn() };
  const engine = new NavigationApiEngine();
  engine.attach(handlers);
  return { engine, navigation, first, handlers };
}

afterEach(() => vi.unstubAllGlobals());

describe('NavigationApiEngine', () => {
  it('exposes the browser history and delegates targeted traversal', () => {
    const { engine, navigation, first } = setup();
    expect(engine.currentEntry()).toBe(first);
    expect(engine.entries()).toEqual([first]);
    const info = { forceNewInstance: true };
    engine.traverseTo(first.key, info);
    expect(navigation.traverseTo).toHaveBeenCalledWith(first.key, { info });
  });

  it('rejects duplicate attachment', () => {
    const { engine, handlers } = setup();
    expect(() => engine.attach(handlers)).toThrow('already attached');
  });

  it('uses the committed entry, watches disposal once and captures the outgoing state before commit', async () => {
    const { engine, navigation, first, handlers } = setup();
    const replacement = entry('replacement', first.key, 0);
    const intercept = vi.fn(({ handler }) => {
      expect(handlers.handleBeforeCommit).toHaveBeenCalledOnce();
      navigation.currentEntry = replacement;
      return handler();
    });
    const event = Object.assign(new Event('navigate'), {
      canIntercept: true, navigationType: 'replace', destination: first,
      info: { forceNewInstance: true }, intercept,
    });
    navigation.dispatchEvent(event);
    await intercept.mock.results[0].value;
    expect(handlers.handleNavigate).toHaveBeenCalledWith({
      navigationType: 'replace', fromId: first.id, committedId: replacement.id,
      destination: replacement, info: event.info,
    });
    // Programmatic commit observation and interception must not add two listeners.
    navigation.navigate.mockReturnValue({ committed: Promise.resolve(replacement), finished: Promise.resolve(replacement) });
    await engine.navigate({ url: '/replacement', state: {}, history: 'replace' }).committed;
    replacement.dispatchEvent(new Event('dispose'));
    expect(handlers.handleDispose).toHaveBeenCalledExactlyOnceWith(replacement.id);
  });

  it('does not orphan a rejected commit while observing disposal', async () => {
    const { engine, navigation } = setup();
    const error = new DOMException('Superseded', 'AbortError');
    navigation.navigate.mockReturnValue({ committed: Promise.reject(error), finished: Promise.reject(error) });
    const result = engine.navigate({ url: '/next', state: {}, history: 'push' });
    expect(await Promise.allSettled([result.committed, result.finished])).toEqual([
      { status: 'rejected', reason: error }, { status: 'rejected', reason: error },
    ]);
  });
});
